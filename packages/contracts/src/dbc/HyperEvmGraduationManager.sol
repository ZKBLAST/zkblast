// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { DammPool } from "../core/DammPool.sol";
import { IERC20Minimal } from "../interfaces/IERC20Minimal.sol";
import { TokenTransfer } from "../libraries/TokenTransfer.sol";
import { FullMath } from "../math/FullMath.sol";
import { BondingCurveMath } from "./BondingCurveMath.sol";
import { DbcTypes } from "./DbcTypes.sol";
import { HyperEvmVirtualPool } from "./HyperEvmVirtualPool.sol";
import { IGraduationAdapter } from "./IGraduationAdapter.sol";
import { LaunchFactory } from "./LaunchFactory.sol";
import { LPAllocationEscrow } from "./LPAllocationEscrow.sol";
import { SegmentedBondingCurveMath } from "./SegmentedBondingCurveMath.sol";

/// @notice One-shot DAMM graduation manager sized for HyperEVM's 3M block gas limit.
contract HyperEvmGraduationManager is ProtocolAccess, UUPSUpgradeable {
    using TokenTransfer for address;

    error InvalidLaunch();
    error InvalidMigration();
    error AdapterUnavailable();
    error AlreadyMigrated();

    LaunchFactory public launchFactory;
    LPAllocationEscrow public lpEscrow;
    mapping(address adapter => bool allowed) public adapterAllowed;
    mapping(bytes32 migrationId => bool completed) public migrationCompleted;

    event AdapterStatusUpdated(address indexed adapter, bool allowed);
    event GraduationCompleted(bytes32 indexed migrationId, bytes32 indexed launchId, address indexed destinationPool, uint256 baseMigrated, uint256 quoteMigrated, uint256 destinationShares);

    constructor() { _disableInitializers(); }

    function initialize(address admin, address upgrader, LaunchFactory launchFactory_, LPAllocationEscrow lpEscrow_) external initializer {
        if (address(launchFactory_) == address(0) || address(lpEscrow_) == address(0)) revert InvalidLaunch();
        __ProtocolAccess_init(admin, upgrader); launchFactory = launchFactory_; lpEscrow = lpEscrow_;
    }

    function setAdapter(address adapter, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (adapter == address(0) || adapter.code.length == 0) revert AdapterUnavailable(); adapterAllowed[adapter] = allowed; emit AdapterStatusUpdated(adapter, allowed);
    }

    function graduate(HyperEvmVirtualPool sourcePool, IGraduationAdapter adapter, uint256 deadline) external returns (address destinationPool, uint256 destinationShares) {
        bytes32 launchId = launchFactory.launchByPool(address(sourcePool));
        if (launchId == bytes32(0)) revert InvalidLaunch();
        if (!adapterAllowed[address(adapter)] || adapter.migrationMode() != DbcTypes.MigrationMode.DAMM || adapter.adapterVersion() == 0) revert AdapterUnavailable();
        bytes32 migrationId = keccak256(abi.encode(address(this), launchId, address(adapter)));
        if (migrationCompleted[migrationId]) revert AlreadyMigrated();
        DbcTypes.TemplateConfig memory config = sourcePool.config();
        if (config.migrationMode != DbcTypes.MigrationMode.DAMM || sourcePool.lifecycle() != DbcTypes.Lifecycle.GRADUATION_READY) revert InvalidMigration();
        (uint128 baseSold, uint128 quoteReserve,,,,,) = sourcePool.accounting();
        address base = sourcePool.baseToken(); address quote = sourcePool.quoteToken();
        uint256 availableBase = IERC20Minimal(base).balanceOf(address(sourcePool));
        if (availableBase == 0 || quoteReserve == 0) revert InvalidMigration();
        uint256 priceX18 = SegmentedBondingCurveMath.marginalPrice(config.curve, BondingCurveMath.normalizeToX18(baseSold, config.baseDecimals));
        (uint256 baseAmount, uint256 quoteAmount) = _migrationAmounts(availableBase, quoteReserve, config.baseDecimals, config.quoteDecimals, priceX18);
        sourcePool.releaseMigrationAssets(address(this), availableBase, quoteReserve);
        if (availableBase > baseAmount) base.pushExact(config.protocolLpRecipient, availableBase - baseAmount);
        if (quoteReserve > quoteAmount) quote.pushExact(config.protocolLpRecipient, quoteReserve - quoteAmount);
        base.forceApprove(address(adapter), baseAmount); quote.forceApprove(address(adapter), quoteAmount);
        IGraduationAdapter.Migration memory migration = IGraduationAdapter.Migration({ baseToken: base, quoteToken: quote, baseDecimals: config.baseDecimals, quoteDecimals: config.quoteDecimals, feePips: config.destinationFeePips, toleranceBps: config.terminalPriceToleranceBps, baseAmount: baseAmount, quoteAmount: quoteAmount, expectedPriceX18: priceX18, minimumShares: config.minimumDestinationShares, lpRecipient: address(lpEscrow), deadline: deadline });
        int24 positionBin; (destinationPool, destinationShares, positionBin) = adapter.migrate(migration);
        if (positionBin != 0 || destinationPool == address(0) || destinationShares == 0) revert InvalidMigration();
        base.forceApprove(address(adapter), 0); quote.forceApprove(address(adapter), 0);
        uint256 creatorShares = FullMath.mulDiv(destinationShares, config.lp.creatorShareBps, DbcTypes.BPS);
        lpEscrow.registerAllocation(migrationId, DammPool(destinationPool), sourcePool.creator(), config.protocolLpRecipient, creatorShares, destinationShares - creatorShares, uint64(block.timestamp + config.lp.creatorLockSeconds));
        migrationCompleted[migrationId] = true; sourcePool.completeGraduation(migrationId, destinationPool, destinationShares);
        emit GraduationCompleted(migrationId, launchId, destinationPool, baseAmount, quoteAmount, destinationShares);
    }

    function _migrationAmounts(uint256 availableBase, uint256 availableQuote, uint8 baseDecimals, uint8 quoteDecimals, uint256 priceX18) private pure returns (uint256 baseAmount, uint256 quoteAmount) {
        uint256 quoteNeeded = BondingCurveMath.denormalizeDown(FullMath.mulDiv(BondingCurveMath.normalizeToX18(availableBase, baseDecimals), priceX18, 1e18), quoteDecimals);
        if (quoteNeeded != 0 && quoteNeeded <= availableQuote) return (availableBase, quoteNeeded);
        baseAmount = BondingCurveMath.denormalizeDown(FullMath.mulDiv(BondingCurveMath.normalizeToX18(availableQuote, quoteDecimals), 1e18, priceX18), baseDecimals);
        if (baseAmount == 0 || baseAmount > availableBase) revert InvalidMigration(); return (baseAmount, availableQuote);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

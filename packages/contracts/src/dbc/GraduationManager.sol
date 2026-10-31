// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { DammPool } from "../core/DammPool.sol";
import { IERC20Minimal } from "../interfaces/IERC20Minimal.sol";
import { TokenTransfer } from "../libraries/TokenTransfer.sol";
import { FullMath } from "../math/FullMath.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { BondingCurveMath } from "./BondingCurveMath.sol";
import { DammGraduationAdapter } from "./DammGraduationAdapter.sol";
import { DbcTypes } from "./DbcTypes.sol";
import { LaunchFactory } from "./LaunchFactory.sol";
import { LPAllocationEscrow } from "./LPAllocationEscrow.sol";
import { SegmentedBondingCurveMath } from "./SegmentedBondingCurveMath.sol";
import { VirtualPool } from "./VirtualPool.sol";

/// @notice Permissionless, atomic and retry-safe graduation coordinator.
contract GraduationManager is ProtocolAccess, UUPSUpgradeable {
    using TokenTransfer for address;

    error AdapterUnavailable();
    error AlreadyMigrated();
    error InvalidLaunch();
    error InvalidMigrationAmounts();

    LaunchFactory public launchFactory;
    LPAllocationEscrow public lpEscrow;
    mapping(address adapter => bool allowed) public adapterAllowed;
    mapping(bytes32 migrationId => bool completed) public migrationCompleted;

    struct MigrationPlan {
        address baseToken;
        address quoteToken;
        uint256 availableBase;
        uint256 availableQuote;
        uint256 baseToMigrate;
        uint256 quoteToMigrate;
        uint256 terminalPriceX18;
    }

    event AdapterStatusUpdated(address indexed adapter, bool allowed);
    event GraduationCompleted(
        bytes32 indexed migrationId,
        bytes32 indexed launchId,
        address indexed destinationPool,
        uint256 baseMigrated,
        uint256 quoteMigrated,
        uint256 destinationShares
    );

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        address upgrader,
        LaunchFactory launchFactory_,
        LPAllocationEscrow lpEscrow_
    ) external initializer {
        if (address(launchFactory_) == address(0) || address(lpEscrow_) == address(0)) {
            revert InvalidLaunch();
        }
        __ProtocolAccess_init(admin, upgrader);
        launchFactory = launchFactory_;
        lpEscrow = lpEscrow_;
    }

    function setAdapter(address adapter, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (adapter == address(0) || adapter.code.length == 0) revert AdapterUnavailable();
        adapterAllowed[adapter] = allowed;
        emit AdapterStatusUpdated(adapter, allowed);
    }

    function graduate(VirtualPool sourcePool, DammGraduationAdapter adapter, uint256 deadline)
        external
        returns (address destinationPool, uint256 destinationShares)
    {
        bytes32 launchId = launchFactory.launchByPool(address(sourcePool));
        if (launchId == bytes32(0)) revert InvalidLaunch();
        if (!adapterAllowed[address(adapter)]) revert AdapterUnavailable();
        bytes32 migrationId = keccak256(abi.encode(address(this), launchId, address(adapter)));
        if (migrationCompleted[migrationId]) revert AlreadyMigrated();

        DbcTypes.TemplateConfig memory config = sourcePool.config();
        MigrationPlan memory plan = _plan(sourcePool, config);
        sourcePool.releaseMigrationAssets(
            address(this), plan.availableBase, plan.availableQuote
        );
        _disposeSurplus(plan, config.protocolLpRecipient);
        plan.baseToken.forceApprove(address(adapter), plan.baseToMigrate);
        plan.quoteToken.forceApprove(address(adapter), plan.quoteToMigrate);
        DammGraduationAdapter.Migration memory migration = DammGraduationAdapter.Migration({
            baseToken: plan.baseToken,
            quoteToken: plan.quoteToken,
            baseDecimals: config.baseDecimals,
            quoteDecimals: config.quoteDecimals,
            feePips: config.destinationFeePips,
            toleranceBps: config.terminalPriceToleranceBps,
            baseAmount: plan.baseToMigrate,
            quoteAmount: plan.quoteToMigrate,
            expectedPriceX18: plan.terminalPriceX18,
            minimumShares: config.minimumDestinationShares,
            lpRecipient: address(lpEscrow),
            deadline: deadline
        });
        (destinationPool, destinationShares) = adapter.migrate(migration);
        plan.baseToken.forceApprove(address(adapter), 0);
        plan.quoteToken.forceApprove(address(adapter), 0);

        uint256 creatorShares =
            FullMath.mulDiv(destinationShares, config.lp.creatorShareBps, DbcTypes.BPS);
        uint256 protocolShares = destinationShares - creatorShares;
        lpEscrow.registerAllocation(
            migrationId,
            DammPool(destinationPool),
            sourcePool.creator(),
            config.protocolLpRecipient,
            creatorShares,
            protocolShares,
            uint64(block.timestamp + config.lp.creatorLockSeconds)
        );
        migrationCompleted[migrationId] = true;
        sourcePool.completeGraduation(migrationId, destinationPool, destinationShares);
        emit GraduationCompleted(
            migrationId,
            launchId,
            destinationPool,
            plan.baseToMigrate,
            plan.quoteToMigrate,
            destinationShares
        );
    }

    function _plan(VirtualPool sourcePool, DbcTypes.TemplateConfig memory config)
        private
        view
        returns (MigrationPlan memory plan)
    {
        (uint128 baseSoldRaw, uint128 quoteReserveRaw,,,,,) = sourcePool.accounting();
        plan.baseToken = sourcePool.baseToken();
        plan.quoteToken = sourcePool.quoteToken();
        plan.availableBase = IERC20Minimal(plan.baseToken).balanceOf(address(sourcePool));
        plan.availableQuote = quoteReserveRaw;
        if (plan.availableBase == 0 || plan.availableQuote == 0) {
            revert InvalidMigrationAmounts();
        }
        uint256 soldX18 = BondingCurveMath.normalizeToX18(baseSoldRaw, config.baseDecimals);
        plan.terminalPriceX18 =
            SegmentedBondingCurveMath.marginalPrice(config.curve, soldX18);
        (plan.baseToMigrate, plan.quoteToMigrate) = _migrationAmounts(
            plan.availableBase,
            plan.availableQuote,
            config.baseDecimals,
            config.quoteDecimals,
            plan.terminalPriceX18
        );
    }

    function _disposeSurplus(MigrationPlan memory plan, address recipient) private {
        uint256 surplusBase = plan.availableBase - plan.baseToMigrate;
        uint256 surplusQuote = plan.availableQuote - plan.quoteToMigrate;
        if (surplusBase != 0) plan.baseToken.pushExact(recipient, surplusBase);
        if (surplusQuote != 0) plan.quoteToken.pushExact(recipient, surplusQuote);
    }

    function _migrationAmounts(
        uint256 availableBase,
        uint256 availableQuote,
        uint8 baseDecimals,
        uint8 quoteDecimals,
        uint256 priceX18
    ) private pure returns (uint256 baseAmount, uint256 quoteAmount) {
        uint256 baseX18 = BondingCurveMath.normalizeToX18(availableBase, baseDecimals);
        uint256 quoteNeededX18 = FullMath.mulDiv(baseX18, priceX18, 1e18);
        uint256 quoteNeeded = BondingCurveMath.denormalizeDown(quoteNeededX18, quoteDecimals);
        if (quoteNeeded != 0 && quoteNeeded <= availableQuote) {
            return (availableBase, quoteNeeded);
        }
        uint256 quoteX18 = BondingCurveMath.normalizeToX18(availableQuote, quoteDecimals);
        uint256 baseNeededX18 = FullMath.mulDiv(quoteX18, 1e18, priceX18);
        baseAmount = BondingCurveMath.denormalizeDown(baseNeededX18, baseDecimals);
        if (baseAmount == 0 || baseAmount > availableBase) revert InvalidMigrationAmounts();
        return (baseAmount, availableQuote);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

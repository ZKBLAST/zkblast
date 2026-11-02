// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { DammPool } from "../core/DammPool.sol";
import { IERC20Minimal } from "../interfaces/IERC20Minimal.sol";
import { TokenTransfer } from "../libraries/TokenTransfer.sol";
import { FullMath } from "../math/FullMath.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { BondingCurveMath } from "./BondingCurveMath.sol";
import { DlmmPool } from "../core/DlmmPool.sol";
import { DbcTypes } from "./DbcTypes.sol";
import { LaunchFactory } from "./LaunchFactory.sol";
import { LPAllocationEscrow } from "./LPAllocationEscrow.sol";
import { IGraduationAdapter } from "./IGraduationAdapter.sol";
import { SegmentedBondingCurveMath } from "./SegmentedBondingCurveMath.sol";
import { VirtualPool } from "./VirtualPool.sol";

interface ILaunchpadGraduationBinding {
    struct Binding {
        uint256 launchpadId;
        uint256 configPresetId;
        bytes32 configHash;
        bytes32 feeSnapshotId;
        address creator;
        address treasury;
        address token;
        address virtualPool;
        uint8 graduationDestination;
    }

    function binding(bytes32 launchId) external view returns (Binding memory);
    function launchByPool(address pool) external view returns (bytes32);
}

interface IERC20Supply {
    function totalSupply() external view returns (uint256);
}

/// @notice Permissionless, atomic and retry-safe graduation coordinator.
contract GraduationManager is ProtocolAccess, UUPSUpgradeable {
    using TokenTransfer for address;

    error AdapterUnavailable();
    error AlreadyMigrated();
    error InvalidLaunch();
    error InvalidMigrationAmounts();
    error InvalidMigrationMode();
    error InvalidMigrationState();
    error UnauthorizedSelfCall();
    error AccountingMismatch();
    error LaunchpadBindingMismatch();

    uint8 public constant MAX_MIGRATION_ATTEMPTS = 3;

    enum MigrationStatus {
        TRADING,
        READY,
        GRADUATING,
        PENDING_RETRY,
        GRADUATED,
        FAILED_NEEDS_REVIEW
    }

    LaunchFactory public launchFactory;
    LPAllocationEscrow public lpEscrow;
    mapping(address adapter => bool allowed) public adapterAllowed;
    mapping(bytes32 migrationId => bool completed) public migrationCompleted;
    mapping(bytes32 migrationId => MigrationRecord record) public migrations;
    mapping(bytes32 launchId => bytes32 migrationId) public migrationByLaunch;
    address public launchpadBindingResolver;
    mapping(bytes32 migrationId => MigrationAccounting accounting) public migrationAccounting;
    mapping(bytes32 migrationId => AdapterSnapshot snapshot) public adapterSnapshots;

    struct MigrationRecord {
        bytes32 launchId;
        address sourcePool;
        address adapter;
        MigrationStatus status;
        uint8 attempts;
        uint64 updatedAt;
        bytes32 lastFailureHash;
        uint256 launchpadId;
        bytes32 configHash;
        bytes32 feeSnapshotId;
        uint8 graduationDestination;
    }

    struct MigrationAccounting {
        uint256 totalSupply;
        uint256 availableBase;
        uint256 availableQuote;
        uint256 baseMigrated;
        uint256 quoteMigrated;
        uint256 baseSurplus;
        uint256 quoteSurplus;
        uint256 creatorFeeLiability;
        uint256 partnerFeeLiability;
        uint256 protocolFeeLiability;
        uint256 baseRoundingDust;
        uint256 quoteRoundingDust;
        uint256 sourceBaseAfter;
        uint256 sourceQuoteAfter;
    }

    struct AdapterSnapshot {
        address factory;
        bytes32 configurationHash;
        uint32 version;
        DbcTypes.MigrationMode mode;
    }

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
    event LaunchpadBindingResolverUpdated(
        address indexed previousResolver, address indexed resolver
    );
    event GraduationContextBound(
        bytes32 indexed migrationId,
        bytes32 indexed launchId,
        uint256 indexed launchpadId,
        bytes32 configHash,
        bytes32 feeSnapshotId,
        uint8 graduationDestination
    );
    event GraduationAttemptStarted(
        bytes32 indexed migrationId,
        bytes32 indexed launchId,
        address indexed sourcePool,
        address adapter,
        uint8 attempt
    );
    event GraduationAdapterBound(
        bytes32 indexed migrationId,
        address indexed adapter,
        address indexed factory,
        uint32 version,
        DbcTypes.MigrationMode mode,
        bytes32 configurationHash
    );
    event GraduationAttemptPending(
        bytes32 indexed migrationId, bytes32 indexed launchId, uint8 attempt, bytes32 failureHash
    );
    event GraduationNeedsReview(
        bytes32 indexed migrationId, bytes32 indexed launchId, uint8 attempts, bytes32 failureHash
    );
    event GraduationReviewReopened(bytes32 indexed migrationId, bytes32 indexed launchId);
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

    function setLaunchpadBindingResolver(address resolver) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (resolver != address(0) && resolver.code.length == 0) revert LaunchpadBindingMismatch();
        address previous = launchpadBindingResolver;
        launchpadBindingResolver = resolver;
        emit LaunchpadBindingResolverUpdated(previous, resolver);
    }

    function graduate(VirtualPool sourcePool, IGraduationAdapter adapter, uint256 deadline)
        external
        returns (address destinationPool, uint256 destinationShares)
    {
        return _attempt(sourcePool, adapter, deadline, false);
    }

    function retryGraduation(bytes32 migrationId, uint256 deadline)
        external
        returns (address destinationPool, uint256 destinationShares)
    {
        MigrationRecord storage record = migrations[migrationId];
        if (record.status != MigrationStatus.PENDING_RETRY) revert InvalidMigrationState();
        return _attempt(
            VirtualPool(record.sourcePool), IGraduationAdapter(record.adapter), deadline, true
        );
    }

    function reopenMigration(bytes32 migrationId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        MigrationRecord storage record = migrations[migrationId];
        if (record.status != MigrationStatus.FAILED_NEEDS_REVIEW) {
            revert InvalidMigrationState();
        }
        record.status = MigrationStatus.PENDING_RETRY;
        record.attempts = 0;
        record.updatedAt = uint64(block.timestamp);
        emit GraduationReviewReopened(migrationId, record.launchId);
    }

    function executeGraduation(
        VirtualPool sourcePool,
        IGraduationAdapter adapter,
        uint256 deadline,
        bytes32 migrationId,
        bytes32 launchId
    ) external returns (address destinationPool, uint256 destinationShares) {
        if (msg.sender != address(this)) revert UnauthorizedSelfCall();
        return _execute(sourcePool, adapter, deadline, migrationId, launchId);
    }

    function statusForPool(VirtualPool sourcePool) external view returns (MigrationStatus) {
        bytes32 launchId = launchFactory.launchByPool(address(sourcePool));
        if (launchId == bytes32(0)) revert InvalidLaunch();
        bytes32 migrationId = migrationByLaunch[launchId];
        if (migrationId != bytes32(0)) return migrations[migrationId].status;
        DbcTypes.Lifecycle lifecycle = sourcePool.lifecycle();
        if (lifecycle == DbcTypes.Lifecycle.GRADUATION_READY) return MigrationStatus.READY;
        if (lifecycle == DbcTypes.Lifecycle.GRADUATED) return MigrationStatus.GRADUATED;
        return MigrationStatus.TRADING;
    }

    function migrationAttemptState(bytes32 migrationId)
        external
        view
        returns (MigrationStatus status, uint8 attempts, bytes32 lastFailureHash)
    {
        MigrationRecord storage record = migrations[migrationId];
        return (record.status, record.attempts, record.lastFailureHash);
    }

    function accountingReconciles(bytes32 migrationId) external view returns (bool) {
        MigrationAccounting storage receipt = migrationAccounting[migrationId];
        return receipt.totalSupply != 0 && receipt.sourceBaseAfter == 0
            && receipt.sourceQuoteAfter
                == receipt.creatorFeeLiability + receipt.partnerFeeLiability
                    + receipt.protocolFeeLiability
            && receipt.availableBase == receipt.baseMigrated + receipt.baseSurplus
            && receipt.availableQuote == receipt.quoteMigrated + receipt.quoteSurplus;
    }

    function migrationContext(bytes32 migrationId)
        external
        view
        returns (
            uint256 launchpadId,
            bytes32 configHash,
            bytes32 feeSnapshotId,
            uint8 graduationDestination
        )
    {
        MigrationRecord storage record = migrations[migrationId];
        return (
            record.launchpadId,
            record.configHash,
            record.feeSnapshotId,
            record.graduationDestination
        );
    }

    function _attempt(
        VirtualPool sourcePool,
        IGraduationAdapter adapter,
        uint256 deadline,
        bool retry
    ) private returns (address destinationPool, uint256 destinationShares) {
        bytes32 launchId = launchFactory.launchByPool(address(sourcePool));
        if (launchId == bytes32(0)) revert InvalidLaunch();
        if (!adapterAllowed[address(adapter)]) revert AdapterUnavailable();
        bytes32 migrationId = keccak256(abi.encode(address(this), launchId, address(adapter)));
        if (migrationCompleted[migrationId]) revert AlreadyMigrated();
        DbcTypes.TemplateConfig memory config = sourcePool.config();
        if (adapter.migrationMode() != config.migrationMode || adapter.adapterVersion() == 0) {
            revert InvalidMigrationMode();
        }
        if (sourcePool.lifecycle() != DbcTypes.Lifecycle.GRADUATION_READY) {
            revert InvalidMigrationState();
        }
        MigrationRecord storage record = migrations[migrationId];
        if (record.sourcePool == address(0)) {
            if (retry || migrationByLaunch[launchId] != bytes32(0)) {
                revert InvalidMigrationState();
            }
            record.launchId = launchId;
            record.sourcePool = address(sourcePool);
            record.adapter = address(adapter);
            record.status = MigrationStatus.READY;
            migrationByLaunch[launchId] = migrationId;
            _bindAdapterSnapshot(migrationId, adapter, config);
            _bindLaunchpadContext(record, migrationId, launchId, address(sourcePool));
        } else if (!retry) {
            revert InvalidMigrationState();
        }
        if (
            record.sourcePool != address(sourcePool) || record.adapter != address(adapter)
                || (record.status != MigrationStatus.READY
                    && record.status != MigrationStatus.PENDING_RETRY)
        ) revert InvalidMigrationState();
        record.status = MigrationStatus.GRADUATING;
        record.attempts += 1;
        record.updatedAt = uint64(block.timestamp);
        emit GraduationAttemptStarted(
            migrationId, launchId, address(sourcePool), address(adapter), record.attempts
        );
        try this.executeGraduation(sourcePool, adapter, deadline, migrationId, launchId) returns (
            address pool, uint256 shares
        ) {
            record.status = MigrationStatus.GRADUATED;
            record.lastFailureHash = bytes32(0);
            record.updatedAt = uint64(block.timestamp);
            return (pool, shares);
        } catch (bytes memory reason) {
            bytes32 failureHash = keccak256(reason);
            record.lastFailureHash = failureHash;
            record.updatedAt = uint64(block.timestamp);
            if (record.attempts >= MAX_MIGRATION_ATTEMPTS) {
                record.status = MigrationStatus.FAILED_NEEDS_REVIEW;
                emit GraduationNeedsReview(migrationId, launchId, record.attempts, failureHash);
            } else {
                record.status = MigrationStatus.PENDING_RETRY;
                emit GraduationAttemptPending(migrationId, launchId, record.attempts, failureHash);
            }
            return (address(0), 0);
        }
    }

    function _execute(
        VirtualPool sourcePool,
        IGraduationAdapter adapter,
        uint256 deadline,
        bytes32 migrationId,
        bytes32 launchId
    ) private returns (address destinationPool, uint256 destinationShares) {
        DbcTypes.TemplateConfig memory config = sourcePool.config();
        MigrationPlan memory plan = _plan(sourcePool, config);
        _captureAccounting(migrationId, sourcePool, plan);
        sourcePool.releaseMigrationAssets(address(this), plan.availableBase, plan.availableQuote);
        _disposeSurplus(plan, config.protocolLpRecipient);
        plan.baseToken.forceApprove(address(adapter), plan.baseToMigrate);
        plan.quoteToken.forceApprove(address(adapter), plan.quoteToMigrate);
        IGraduationAdapter.Migration memory migration = IGraduationAdapter.Migration({
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
        int24 positionBin;
        (destinationPool, destinationShares, positionBin) = adapter.migrate(migration);
        plan.baseToken.forceApprove(address(adapter), 0);
        plan.quoteToken.forceApprove(address(adapter), 0);

        _registerAllocation(
            migrationId,
            sourcePool,
            destinationPool,
            destinationShares,
            positionBin,
            config
        );
        migrationCompleted[migrationId] = true;
        sourcePool.completeGraduation(migrationId, destinationPool, destinationShares);
        _finalizeAccounting(migrationId, sourcePool, plan);
        emit GraduationCompleted(
            migrationId,
            launchId,
            destinationPool,
            plan.baseToMigrate,
            plan.quoteToMigrate,
            destinationShares
        );
    }

    function _captureAccounting(
        bytes32 migrationId,
        VirtualPool sourcePool,
        MigrationPlan memory plan
    ) private {
        (
            ,,
            uint128 creatorFee,
            uint128 partnerFee,
            uint128 protocolFee,
            uint128 baseDust,
            uint128 quoteDust
        ) = sourcePool.accounting();
        MigrationAccounting storage receipt = migrationAccounting[migrationId];
        receipt.totalSupply = IERC20Supply(plan.baseToken).totalSupply();
        receipt.availableBase = plan.availableBase;
        receipt.availableQuote = plan.availableQuote;
        receipt.baseMigrated = plan.baseToMigrate;
        receipt.quoteMigrated = plan.quoteToMigrate;
        receipt.baseSurplus = plan.availableBase - plan.baseToMigrate;
        receipt.quoteSurplus = plan.availableQuote - plan.quoteToMigrate;
        receipt.creatorFeeLiability = creatorFee;
        receipt.partnerFeeLiability = partnerFee;
        receipt.protocolFeeLiability = protocolFee;
        receipt.baseRoundingDust = baseDust;
        receipt.quoteRoundingDust = quoteDust;
    }

    function _bindAdapterSnapshot(
        bytes32 migrationId,
        IGraduationAdapter adapter,
        DbcTypes.TemplateConfig memory config
    ) private {
        address factory = adapter.factory();
        uint32 version = adapter.adapterVersion();
        bytes32 adapterConfigHash = adapter.configurationHash();
        DbcTypes.MigrationMode mode = adapter.migrationMode();
        if (
            factory == address(0) || factory.code.length == 0 || version == 0
                || adapterConfigHash == bytes32(0) || mode != config.migrationMode
        ) revert AdapterUnavailable();
        adapterSnapshots[migrationId] = AdapterSnapshot({
            factory: factory,
            configurationHash: adapterConfigHash,
            version: version,
            mode: mode
        });
        emit GraduationAdapterBound(
            migrationId, address(adapter), factory, version, mode, adapterConfigHash
        );
    }

    function _registerAllocation(
        bytes32 migrationId,
        VirtualPool sourcePool,
        address destinationPool,
        uint256 destinationShares,
        int24 positionBin,
        DbcTypes.TemplateConfig memory config
    ) private {
        uint256 creatorShares = FullMath.mulDiv(
            destinationShares, config.lp.creatorShareBps, DbcTypes.BPS
        );
        uint64 creatorUnlockAt = uint64(block.timestamp + config.lp.creatorLockSeconds);
        if (config.migrationMode == DbcTypes.MigrationMode.DLMM) {
            lpEscrow.registerDlmmAllocation(
                migrationId,
                DlmmPool(destinationPool),
                positionBin,
                sourcePool.creator(),
                config.protocolLpRecipient,
                creatorShares,
                destinationShares - creatorShares,
                creatorUnlockAt
            );
        } else {
            lpEscrow.registerAllocation(
                migrationId,
                DammPool(destinationPool),
                sourcePool.creator(),
                config.protocolLpRecipient,
                creatorShares,
                destinationShares - creatorShares,
                creatorUnlockAt
            );
        }
    }

    function _finalizeAccounting(
        bytes32 migrationId,
        VirtualPool sourcePool,
        MigrationPlan memory plan
    ) private {
        MigrationAccounting storage receipt = migrationAccounting[migrationId];
        receipt.sourceBaseAfter = IERC20Minimal(plan.baseToken).balanceOf(address(sourcePool));
        receipt.sourceQuoteAfter = IERC20Minimal(plan.quoteToken).balanceOf(address(sourcePool));
        uint256 liabilities = receipt.creatorFeeLiability + receipt.partnerFeeLiability
            + receipt.protocolFeeLiability;
        if (
            receipt.sourceBaseAfter != 0 || receipt.sourceQuoteAfter != liabilities
                || plan.availableBase != receipt.baseMigrated + receipt.baseSurplus
                || plan.availableQuote != receipt.quoteMigrated + receipt.quoteSurplus
        ) revert AccountingMismatch();
    }

    function _bindLaunchpadContext(
        MigrationRecord storage record,
        bytes32 migrationId,
        bytes32 launchId,
        address sourcePool
    ) private {
        address resolver = launchpadBindingResolver;
        if (resolver == address(0)) return;
        bytes32 boundLaunch;
        try ILaunchpadGraduationBinding(resolver).launchByPool(sourcePool) returns (bytes32 value) {
            boundLaunch = value;
        } catch {
            revert LaunchpadBindingMismatch();
        }
        if (boundLaunch == bytes32(0)) return;
        if (boundLaunch != launchId) revert LaunchpadBindingMismatch();
        try ILaunchpadGraduationBinding(resolver).binding(launchId) returns (
            ILaunchpadGraduationBinding.Binding memory binding
        ) {
            DbcTypes.TemplateConfig memory config = VirtualPool(sourcePool).config();
            uint8 expectedDestination = config.migrationMode == DbcTypes.MigrationMode.DAMM ? 1 : 2;
            if (
                binding.virtualPool != sourcePool || binding.token == address(0)
                    || binding.graduationDestination != expectedDestination
            ) revert LaunchpadBindingMismatch();
            record.launchpadId = binding.launchpadId;
            record.configHash = binding.configHash;
            record.feeSnapshotId = binding.feeSnapshotId;
            record.graduationDestination = binding.graduationDestination;
            emit GraduationContextBound(
                migrationId,
                launchId,
                binding.launchpadId,
                binding.configHash,
                binding.feeSnapshotId,
                binding.graduationDestination
            );
        } catch (bytes memory reason) {
            if (reason.length != 0) revert LaunchpadBindingMismatch();
        }
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
        plan.terminalPriceX18 = SegmentedBondingCurveMath.marginalPrice(config.curve, soldX18);
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

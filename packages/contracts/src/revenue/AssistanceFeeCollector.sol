// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20Minimal} from "../interfaces/IERC20Minimal.sol";
import {TokenTransfer} from "../libraries/TokenTransfer.sol";
import {UUPSUpgradeable} from "../proxy/UUPSUpgradeable.sol";
import {ReentrancyGuard} from "../security/ReentrancyGuard.sol";
import {ProtocolAccess} from "../access/ProtocolAccess.sol";
import {AssistanceFundTypes} from "./AssistanceFundTypes.sol";
import {IAssistanceFundEvents} from "./IAssistanceFundEvents.sol";
import {ProtocolFeeRegistry} from "./ProtocolFeeRegistry.sol";

/// @notice Custodies and allocates only revenue authenticated by ProtocolFeeRegistry.
/// @dev This phase intentionally exposes no withdrawal or sweep function.
contract AssistanceFeeCollector is ProtocolAccess, UUPSUpgradeable, ReentrancyGuard, IAssistanceFundEvents {
    using TokenTransfer for address;

    ProtocolFeeRegistry public registry;
    address public treasuryController;
    address public buybackExecutor;
    mapping(address asset => AssistanceFundTypes.AssetLedger ledger) private _assetLedgers;
    mapping(bytes32 sourceId => AssistanceFundTypes.AssetLedger ledger) private _sourceLedgers;
    mapping(bytes32 epochId => uint256 eligibleAmount) public eligibleByEpoch;

    event TreasuryControllerBound(address indexed controller);
    event BuybackExecutorBound(address indexed executor);

    constructor() {
        _disableInitializers();
    }

    function initialize(address governanceTimelock, ProtocolFeeRegistry registry_) external initializer {
        if (address(registry_) == address(0) || address(registry_).code.length == 0) {
            revert InvalidSource();
        }
        __ProtocolAccess_init(governanceTimelock, governanceTimelock);
        registry = registry_;
    }

    function recordRevenue(
        bytes32 sourceId,
        uint64 epoch,
        AssistanceFundTypes.RevenueKind kind,
        uint256 grossAmount,
        uint256 excludedObligations,
        uint256 eligibleAmount
    ) external nonReentrant returns (bytes32 epochId, AssistanceFundTypes.Allocation memory split) {
        if (epoch == 0 || eligibleAmount == 0 || grossAmount != excludedObligations + eligibleAmount) {
            revert InvalidAmount();
        }
        if (kind == AssistanceFundTypes.RevenueKind.REALIZED_RESERVE_YIELD) {
            revert SourceInactive();
        }

        ProtocolFeeRegistry.SourceRecord memory source = registry.sourceRecord(sourceId);
        if (!registry.isActive(sourceId, msg.sender, source.asset)) revert SourceInactive();

        source.asset.pullExact(msg.sender, eligibleAmount);
        split = AssistanceFundTypes.allocate(eligibleAmount);
        epochId = AssistanceFundTypes.epochId(sourceId, epoch);

        _accrue(_assetLedgers[source.asset], eligibleAmount, split);
        _accrue(_sourceLedgers[sourceId], eligibleAmount, split);
        eligibleByEpoch[epochId] += eligibleAmount;

        emit ProtocolRevenueRecorded(
            sourceId, epochId, source.asset, kind, grossAmount, excludedObligations, eligibleAmount
        );
        emit ProtocolFeeAllocated(
            sourceId, epochId, source.asset, eligibleAmount, split.buybackAmount, split.treasuryAmount
        );
    }

    function bindTreasuryController(address controller) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (treasuryController != address(0) || controller == address(0) || controller.code.length == 0) {
            revert InvalidSource();
        }
        treasuryController = controller;
        emit TreasuryControllerBound(controller);
    }

    function bindBuybackExecutor(address executor) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (buybackExecutor != address(0) || executor == address(0) || executor.code.length == 0) {
            revert InvalidSource();
        }
        buybackExecutor = executor;
        emit BuybackExecutorBound(executor);
    }

    function releaseBuyback(address asset, address recipient, uint256 amount) external nonReentrant {
        if (msg.sender != buybackExecutor || recipient != buybackExecutor || amount == 0) {
            revert InvalidAmount();
        }
        AssistanceFundTypes.AssetLedger storage ledger = _assetLedgers[asset];
        if (amount > AssistanceFundTypes.pendingBuyback(ledger)) revert InvalidAmount();
        ledger.spentBuyback += amount;
        asset.pushExact(recipient, amount);
        if (!AssistanceFundTypes.isConserved(ledger)) revert AccountingInvariantViolated();
    }

    function releaseTreasury(address asset, address recipient, uint256 amount) external nonReentrant {
        if (msg.sender != treasuryController || recipient == address(0) || amount == 0) {
            revert InvalidAmount();
        }
        AssistanceFundTypes.AssetLedger storage ledger = _assetLedgers[asset];
        if (amount > AssistanceFundTypes.treasuryClaimable(ledger)) revert InvalidAmount();
        ledger.claimedTreasury += amount;
        asset.pushExact(recipient, amount);
        if (!AssistanceFundTypes.isConserved(ledger)) revert AccountingInvariantViolated();
        emit TreasuryClaimed(asset, recipient, amount);
    }

    function assetLedger(address asset) external view returns (AssistanceFundTypes.AssetLedger memory) {
        return _assetLedgers[asset];
    }

    function sourceLedger(bytes32 sourceId) external view returns (AssistanceFundTypes.AssetLedger memory) {
        return _sourceLedgers[sourceId];
    }

    function reconciliation(address asset)
        external
        view
        returns (
            uint256 balance,
            uint256 pendingBuyback,
            uint256 treasuryClaimable,
            uint256 liability,
            uint256 surplus,
            bool solvent
        )
    {
        AssistanceFundTypes.AssetLedger memory ledger = _assetLedgers[asset];
        balance = IERC20Minimal(asset).balanceOf(address(this));
        pendingBuyback = AssistanceFundTypes.pendingBuyback(ledger);
        treasuryClaimable = AssistanceFundTypes.treasuryClaimable(ledger);
        liability = pendingBuyback + treasuryClaimable;
        if (balance > liability) surplus = balance - liability;
        solvent = balance >= liability && AssistanceFundTypes.isConserved(ledger);
    }

    function _accrue(
        AssistanceFundTypes.AssetLedger storage ledger,
        uint256 eligibleAmount,
        AssistanceFundTypes.Allocation memory split
    ) private {
        ledger.collected += eligibleAmount;
        ledger.allocatedBuyback += split.buybackAmount;
        ledger.allocatedTreasury += split.treasuryAmount;
        if (!AssistanceFundTypes.isConserved(ledger)) revert AccountingInvariantViolated();
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}

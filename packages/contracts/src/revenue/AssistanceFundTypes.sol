// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FullMath } from "../math/FullMath.sol";

/// @notice Shared value types and deterministic accounting rules for protocol-owned revenue.
library AssistanceFundTypes {
    uint16 internal constant BPS = 10_000;
    uint16 internal constant BUYBACK_BPS = 9_900;
    uint16 internal constant TREASURY_BPS = BPS - BUYBACK_BPS;
    bytes32 internal constant DBC_PROTOCOL_REVENUE_V1 =
        keccak256("ZKBLAST_DBC_PROTOCOL_REVENUE_V1");
    bytes32 internal constant DAMM_PROTOCOL_FEE_V1 = keccak256("ZKBLAST_DAMM_PROTOCOL_FEE_V1");
    bytes32 internal constant DLMM_PROTOCOL_FEE_V1 = keccak256("ZKBLAST_DLMM_PROTOCOL_FEE_V1");

    enum RevenueKind {
        PROTOCOL_TRADE_FEE,
        PROTOCOL_POOL_FEE,
        PROTOCOL_GRADUATION_FEE,
        REALIZED_RESERVE_YIELD
    }

    enum SourceStatus {
        UNREGISTERED,
        ACTIVE,
        INACTIVE
    }

    enum BurnMethod {
        TOKEN_BURN,
        DEAD_ADDRESS_TRANSFER
    }

    struct SourceKey {
        uint256 chainId;
        address source;
        address asset;
        bytes32 adapterId;
    }

    struct RevenueReceipt {
        bytes32 sourceId;
        bytes32 epochId;
        RevenueKind kind;
        address asset;
        uint256 grossAmount;
        uint256 excludedObligations;
        uint256 eligibleAmount;
    }

    struct Allocation {
        uint256 buybackAmount;
        uint256 treasuryAmount;
    }

    struct AssetLedger {
        uint256 collected;
        uint256 allocatedBuyback;
        uint256 allocatedTreasury;
        uint256 spentBuyback;
        uint256 claimedTreasury;
        uint256 burnedProtocolToken;
    }

    struct ExecutionLimits {
        uint256 minimumAmount;
        uint256 maximumAmount;
        uint256 maximumDailySpend;
        uint128 minimumPoolLiquidity;
        uint32 cooldownSeconds;
        uint32 oracleStalenessSeconds;
        uint32 swapDeadlineSeconds;
        uint16 maximumSlippageBps;
        uint16 maximumPriceImpactBps;
        uint16 maximumOracleDeviationBps;
    }

    function sourceId(SourceKey memory key, address registry) internal pure returns (bytes32) {
        return keccak256(abi.encode(key.chainId, registry, key.source, key.asset, key.adapterId));
    }

    function epochId(bytes32 sourceId_, uint64 epoch) internal pure returns (bytes32) {
        return keccak256(abi.encode(sourceId_, epoch));
    }

    /// @dev Rounding always benefits treasury: buyback rounds down, treasury receives residual.
    function allocate(uint256 eligibleAmount) internal pure returns (Allocation memory result) {
        result.buybackAmount = FullMath.mulDiv(eligibleAmount, BUYBACK_BPS, BPS);
        result.treasuryAmount = eligibleAmount - result.buybackAmount;
    }

    function pendingBuyback(AssetLedger memory ledger) internal pure returns (uint256) {
        return ledger.allocatedBuyback - ledger.spentBuyback;
    }

    function treasuryClaimable(AssetLedger memory ledger) internal pure returns (uint256) {
        return ledger.allocatedTreasury - ledger.claimedTreasury;
    }

    function isConserved(AssetLedger memory ledger) internal pure returns (bool) {
        return ledger.collected == ledger.allocatedBuyback + ledger.allocatedTreasury
            && ledger.spentBuyback <= ledger.allocatedBuyback
            && ledger.claimedTreasury <= ledger.allocatedTreasury;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Canonical value types shared by the ZKBLAST DBC contracts.
library DbcTypes {
    uint16 internal constant BPS = 10_000;
    uint16 internal constant MAX_TRADE_FEE_BPS = 500;
    uint8 internal constant MAX_CURVE_SEGMENTS = 16;
    uint8 internal constant MVP_CURVE_SEGMENTS = 1;
    uint256 internal constant WAD = 1e18;

    enum Lifecycle {
        DRAFT,
        ACTIVE,
        PAUSED,
        GRADUATION_READY,
        GRADUATED
    }

    enum MigrationMode {
        DAMM,
        DLMM
    }

    /// @dev Both values use 18-decimal normalized quote/base math.
    struct LinearSegment {
        uint128 initialPriceX18;
        uint128 slopeX18;
        uint128 saleCapacityX18;
    }

    struct CurveConfig {
        uint8 segmentCount;
        LinearSegment[16] segments;
    }

    struct FeePolicy {
        uint16 tradeFeeBps;
        uint16 creatorShareBps;
        uint16 partnerShareBps;
        uint16 protocolShareBps;
    }

    struct LpPolicy {
        uint16 creatorShareBps;
        uint16 protocolShareBps;
        uint32 creatorLockSeconds;
    }

    /// @dev A live pool snapshots this configuration so template updates cannot
    ///      mutate its economics.
    struct TemplateConfig {
        address quoteToken;
        address protocolFeeRecipient;
        address partnerFeeRecipient;
        address protocolLpRecipient;
        uint8 quoteDecimals;
        uint8 baseDecimals;
        MigrationMode migrationMode;
        uint24 destinationFeePips;
        uint16 terminalPriceToleranceBps;
        uint128 totalSupplyRaw;
        uint128 baseInventoryRaw;
        uint128 graduationThresholdRaw;
        uint128 minimumDestinationShares;
        CurveConfig curve;
        FeePolicy fees;
        LpPolicy lp;
    }

    struct PoolAccounting {
        uint128 baseSoldRaw;
        uint128 realQuoteReserveRaw;
        uint128 creatorFeeLiabilityRaw;
        uint128 partnerFeeLiabilityRaw;
        uint128 protocolFeeLiabilityRaw;
        uint128 baseRoundingDustRaw;
        uint128 quoteRoundingDustRaw;
    }

    struct GraduationState {
        bytes32 migrationId;
        address destinationPool;
        uint256 destinationShares;
        uint256 creatorSharesClaimed;
        uint256 protocolSharesClaimed;
        uint64 graduatedAt;
    }
}

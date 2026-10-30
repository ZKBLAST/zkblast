// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

library PerpTypes {
    uint16 internal constant BPS = 10_000;
    uint32 internal constant MAX_LEVERAGE_BPS = 100_000;

    struct MarketConfig {
        address baseAsset;
        bytes32 oracleId;
        uint128 maxOpenInterestUsd;
        uint128 maxSkewUsd;
        uint128 maxPositionUsd;
        uint128 minPositionUsd;
        uint32 maxLeverageBps;
        uint16 maintenanceMarginBps;
        uint16 positionFeeBps;
        uint16 liquidationFeeBps;
        uint16 maxPriceImpactBps;
        bool enabled;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FullMath} from "../math/FullMath.sol";
import {IAggregatorV3} from "../perps/interfaces/IAggregatorV3.sol";

/// @notice Converts a managed ZKBLAST/USD feed into USDG-per-ZKBLAST route reference data.
/// @dev USDG is treated as one USD. Freshness and deviation remain enforced by the route registry.
contract ManagedFeedReferenceOracle {
    error InvalidConfiguration();
    error InvalidPair();
    error InvalidObservation();

    address public immutable quoteAsset;
    address public immutable protocolToken;
    IAggregatorV3 public immutable protocolTokenUsdFeed;
    uint8 public immutable feedDecimals;

    constructor(address quoteAsset_, address protocolToken_, IAggregatorV3 feed_) {
        if (
            quoteAsset_.code.length == 0 || protocolToken_.code.length == 0
                || address(feed_).code.length == 0 || quoteAsset_ == protocolToken_
        ) revert InvalidConfiguration();
        uint8 decimals_ = feed_.decimals();
        if (decimals_ > 18) revert InvalidConfiguration();
        quoteAsset = quoteAsset_;
        protocolToken = protocolToken_;
        protocolTokenUsdFeed = feed_;
        feedDecimals = decimals_;
    }

    function referencePrice(address inputAsset, address outputAsset)
        external
        view
        returns (uint256 outputPerInputX18, uint64 updatedAt, uint32 observations)
    {
        if (inputAsset != quoteAsset || outputAsset != protocolToken) revert InvalidPair();
        (uint80 roundId, int256 answer,, uint256 observedAt, uint80 answeredInRound) =
            protocolTokenUsdFeed.latestRoundData();
        if (
            answer <= 0 || observedAt == 0 || observedAt > block.timestamp
                || answeredInRound < roundId || roundId == 0 || observedAt > type(uint64).max
        ) revert InvalidObservation();

        uint256 tokenUsdX18 = FullMath.mulDiv(uint256(answer), 1e18, 10 ** feedDecimals);
        outputPerInputX18 = FullMath.mulDiv(1e18, 1e18, tokenUsdX18);
        updatedAt = uint64(observedAt);
        observations = roundId > type(uint32).max ? type(uint32).max : uint32(roundId);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IAggregatorV3} from "../src/perps/interfaces/IAggregatorV3.sol";
import {ManagedFeedReferenceOracle} from "../src/revenue/ManagedFeedReferenceOracle.sol";

contract ReferenceAssetMock {}

contract ReferenceFeedMock is IAggregatorV3 {
    uint8 public constant decimals = 8;
    string public constant description = "ZKBLAST / USD";
    uint80 public roundId = 2;
    int256 public answer = 1_000_000;
    uint256 public updatedAt = block.timestamp;
    uint80 public answeredInRound = 2;

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (roundId, answer, updatedAt, updatedAt, answeredInRound);
    }

    function setObservation(uint80 roundId_, int256 answer_, uint256 updatedAt_) external {
        roundId = roundId_;
        answer = answer_;
        updatedAt = updatedAt_;
        answeredInRound = roundId_;
    }
}

contract ManagedFeedReferenceOracleTest {
    ReferenceAssetMock private quote;
    ReferenceAssetMock private token;
    ReferenceFeedMock private feed;
    ManagedFeedReferenceOracle private oracle;

    function setUp() public {
        quote = new ReferenceAssetMock();
        token = new ReferenceAssetMock();
        feed = new ReferenceFeedMock();
        oracle = new ManagedFeedReferenceOracle(address(quote), address(token), feed);
    }

    function testConvertsUsdPerTokenIntoTokenPerUsdg() external view {
        (uint256 price, uint64 updatedAt, uint32 observations) =
            oracle.referencePrice(address(quote), address(token));
        require(price == 100e18, "inverse price");
        require(updatedAt == block.timestamp, "timestamp");
        require(observations == 2, "observations");
    }

    function testRejectsUnsupportedDirection() external {
        (bool accepted,) = address(oracle).call(
            abi.encodeCall(oracle.referencePrice, (address(token), address(quote)))
        );
        require(!accepted, "pair accepted");
    }

    function testRejectsInvalidFeedObservation() external {
        feed.setObservation(2, 0, block.timestamp);
        (bool accepted,) = address(oracle).call(
            abi.encodeCall(oracle.referencePrice, (address(quote), address(token)))
        );
        require(!accepted, "zero answer accepted");
    }
}

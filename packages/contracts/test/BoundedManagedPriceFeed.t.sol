// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { BoundedManagedPriceFeed } from "../src/perps/BoundedManagedPriceFeed.sol";

interface VmManagedFeed {
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
}

contract BoundedManagedPriceFeedTest {
    VmManagedFeed private constant vm = VmManagedFeed(address(uint160(uint256(keccak256("hevm cheat code")))));
    BoundedManagedPriceFeed private feed;
    address private reporter = address(0xBEEF);

    function setUp() external {
        vm.warp(1_800_000_000);
        feed = new BoundedManagedPriceFeed(address(this), reporter, "PONS / USD", 23_703_797, block.timestamp, 500, 15 minutes);
    }

    function testReporterCanSubmitBoundedFreshPrice() external {
        vm.prank(reporter);
        feed.submit(24_000_000, block.timestamp);
        (uint80 roundId, int256 answer,,, uint80 answeredInRound) = feed.latestRoundData();
        require(roundId == 2 && answer == 24_000_000 && answeredInRound == roundId, "valid update mismatch");
    }

    function testRejectsUnauthorizedStaleAndExcessiveUpdates() external {
        (bool unauthorized,) = address(feed).call(abi.encodeCall(feed.submit, (24_000_000, block.timestamp)));
        require(!unauthorized, "unauthorized update accepted");
        vm.prank(reporter);
        (bool stale,) = address(feed).call(abi.encodeCall(feed.submit, (24_000_000, block.timestamp - 16 minutes)));
        require(!stale, "stale update accepted");
        vm.prank(reporter);
        (bool excessive,) = address(feed).call(abi.encodeCall(feed.submit, (30_000_000, block.timestamp)));
        require(!excessive, "excessive update accepted");
    }
}

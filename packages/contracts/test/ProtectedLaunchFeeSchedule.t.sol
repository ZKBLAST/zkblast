// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    ProtectedLaunchFeeSchedule
} from "../src/launchpad/protection/ProtectedLaunchFeeSchedule.sol";
import { BondingCurveMath } from "../src/dbc/BondingCurveMath.sol";

contract ProtectedLaunchFeeScheduleHarness {
    function feeBpsAt(
        uint256 currentBlock,
        uint64 startBlock,
        uint32 protectionBlocks,
        uint16 initialFeeBps,
        uint16 baseFeeBps
    ) external pure returns (uint16) {
        return ProtectedLaunchFeeSchedule.feeBpsAt(
            currentBlock, startBlock, protectionBlocks, initialFeeBps, baseFeeBps
        );
    }

    function quote(uint256 grossAmount, uint16 feeBps)
        external
        pure
        returns (uint256 fee, uint256 net)
    {
        fee = ProtectedLaunchFeeSchedule.feeOnGross(grossAmount, feeBps);
        net = ProtectedLaunchFeeSchedule.netFromGross(grossAmount, feeBps);
    }

    function normalize(uint256 amount, uint8 decimals) external pure returns (uint256) {
        return BondingCurveMath.normalizeToX18(amount, decimals);
    }

    function denormalize(uint256 amountX18, uint8 decimals) external pure returns (uint256) {
        return BondingCurveMath.denormalizeDown(amountX18, decimals);
    }
}

contract ProtectedLaunchFeeScheduleTest {
    ProtectedLaunchFeeScheduleHarness private harness;

    function setUp() public {
        harness = new ProtectedLaunchFeeScheduleHarness();
    }

    function testUsesInitialFeeBeforeAndAtStart() external view {
        require(harness.feeBpsAt(99, 100, 100, 500, 100) == 500, "before start");
        require(harness.feeBpsAt(100, 100, 100, 500, 100) == 500, "at start");
    }

    function testDecaysLinearlyAndEndsAtBaseFee() external view {
        require(harness.feeBpsAt(125, 100, 100, 500, 100) == 400, "quarter");
        require(harness.feeBpsAt(150, 100, 100, 500, 100) == 300, "half");
        require(harness.feeBpsAt(175, 100, 100, 500, 100) == 200, "three quarters");
        require(harness.feeBpsAt(200, 100, 100, 500, 100) == 100, "end");
        require(harness.feeBpsAt(500, 100, 100, 500, 100) == 100, "after end");
    }

    function testRoundingIsDeterministicAndConservesGross() external view {
        (uint256 fee, uint256 net) = harness.quote(101, 333);
        require(fee == 3, "fee rounds down");
        require(net == 98, "net");
        require(fee + net == 101, "gross conservation");
    }

    function testRejectsInvalidSchedules() external {
        (bool zeroWindow,) = address(harness)
            .call(
                abi.encodeCall(
                    ProtectedLaunchFeeScheduleHarness.feeBpsAt,
                    (100, uint64(100), uint32(0), uint16(500), uint16(100))
                )
            );
        (bool inverted,) = address(harness)
            .call(
                abi.encodeCall(
                    ProtectedLaunchFeeScheduleHarness.feeBpsAt,
                    (100, uint64(100), uint32(100), uint16(100), uint16(500))
                )
            );
        require(!zeroWindow && !inverted, "invalid schedule accepted");
    }

    function testFuzzFeeAndDecimalBoundaries(
        uint16 initialSeed,
        uint16 baseSeed,
        uint32 windowSeed,
        uint32 elapsedSeed,
        uint128 grossSeed,
        uint8 decimalsSeed
    ) external view {
        uint16 initialFee = uint16(uint256(initialSeed) % 10_001);
        uint16 baseFee = uint16(uint256(baseSeed) % (uint256(initialFee) + 1));
        uint32 window = uint32(uint256(windowSeed) % 1_000_000 + 1);
        uint256 elapsed = uint256(elapsedSeed) % (uint256(window) * 2 + 1);
        uint16 feeBps = harness.feeBpsAt(100 + elapsed, 100, window, initialFee, baseFee);
        require(feeBps >= baseFee && feeBps <= initialFee, "fee bounds");

        uint256 gross = uint256(grossSeed);
        (uint256 fee, uint256 net) = harness.quote(gross, feeBps);
        require(fee + net == gross, "fuzz gross conservation");
        require(fee <= gross, "fee overflow");

        uint8 decimals = uint8(uint256(decimalsSeed) % 19);
        uint256 amount = gross % 1e30;
        uint256 normalized = harness.normalize(amount, decimals);
        require(harness.denormalize(normalized, decimals) == amount, "decimal round trip");
    }
}

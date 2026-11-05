// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { StockQuoteMath } from "../src/stock/StockQuoteMath.sol";

contract StockQuoteMathHarness {
    function toWad(uint256 amount, uint8 decimals) external pure returns (uint256) {
        return StockQuoteMath.toWad(amount, decimals);
    }

    function fromWad(uint256 amount, uint8 decimals, bool roundUp) external pure returns (uint256) {
        return StockQuoteMath.fromWad(amount, decimals, roundUp);
    }

    function usdNotionalX18(
        uint256 amount,
        uint8 tokenDecimals,
        uint256 price,
        uint8 priceDecimals,
        uint256 multiplierX18
    ) external pure returns (uint256) {
        return StockQuoteMath.usdNotionalX18(
            amount, tokenDecimals, price, priceDecimals, multiplierX18
        );
    }
}

contract StockQuoteMathTest {
    StockQuoteMathHarness private immutable harness = new StockQuoteMathHarness();

    function testConvertsSixAndEighteenDecimalAmounts() external view {
        require(harness.toWad(1_500_000, 6) == 1.5 ether, "six to wad");
        require(harness.fromWad(1.5 ether, 6, false) == 1_500_000, "wad to six");
        require(harness.toWad(2 ether, 18) == 2 ether, "eighteen to wad");
    }

    function testRoundsLiabilityConversionUpWhenRequested() external view {
        require(harness.fromWad(1 ether + 1, 6, false) == 1_000_000, "floor");
        require(harness.fromWad(1 ether + 1, 6, true) == 1_000_001, "ceil");
    }

    function testAppliesIssuerMultiplierExactlyOnce() external view {
        uint256 notional = harness.usdNotionalX18(2 ether, 18, 25_000_000_000, 8, 2 ether);
        require(notional == 1_000 ether, "multiplier-adjusted notional");
    }

    function testHandlesZeroOneWeiUnusualDecimalsAndLargeBoundedValues() external view {
        require(harness.toWad(0, 8) == 0, "zero");
        require(harness.toWad(1, 8) == 10_000_000_000, "one raw unit");
        require(harness.fromWad(10_000_000_001, 8, false) == 1, "unusual floor");
        require(harness.fromWad(10_000_000_001, 8, true) == 2, "unusual ceil");
        uint256 amount = type(uint128).max;
        require(harness.fromWad(harness.toWad(amount, 18), 18, false) == amount, "large");
    }

    function testFuzzRoundTripDoesNotCreateRawUnits(uint128 amount, uint8 decimalsSeed)
        external
        view
    {
        uint8 decimals = uint8(uint256(decimalsSeed) % 37);
        uint256 normalized = harness.toWad(uint256(amount), decimals);
        uint256 restored = harness.fromWad(normalized, decimals, false);
        require(restored <= amount, "round trip created units");
        if (decimals <= 18) {
            require(restored == amount, "lossless scale lost units");
        } else {
            require(amount - restored < 10 ** (decimals - 18), "truncation exceeded scale");
        }
    }

    function testFuzzFloorAndCeilBoundTheOriginalWad(uint128 amount, uint8 decimalsSeed)
        external
        view
    {
        uint8 decimals = uint8(uint256(decimalsSeed) % 19);
        uint256 wadAmount = uint256(amount);
        uint256 floorRaw = harness.fromWad(wadAmount, decimals, false);
        uint256 ceilRaw = harness.fromWad(wadAmount, decimals, true);
        require(harness.toWad(floorRaw, decimals) <= wadAmount, "floor exceeds input");
        require(harness.toWad(ceilRaw, decimals) >= wadAmount, "ceil below input");
        require(ceilRaw - floorRaw <= 1, "rounding gap");
    }

    function testFuzzNotionalIsMonotonic(uint96 leftSeed, uint96 rightSeed) external view {
        uint256 left = uint256(leftSeed);
        uint256 right = uint256(rightSeed);
        if (left > right) (left, right) = (right, left);
        uint256 leftNotional = harness.usdNotionalX18(left, 18, 250e8, 8, 1 ether);
        uint256 rightNotional = harness.usdNotionalX18(right, 18, 250e8, 8, 1 ether);
        require(leftNotional <= rightNotional, "notional not monotonic");
    }
}

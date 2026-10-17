// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { BinPriceMath } from "../src/math/BinPriceMath.sol";
import { ConstantProductMath } from "../src/math/ConstantProductMath.sol";
import { FullMath } from "../src/math/FullMath.sol";

contract MathKernelTest {
    function testFullPrecisionMulDiv() external pure {
        uint256 result = FullMath.mulDiv(type(uint128).max, type(uint128).max, 1e18);
        require(
            result == 115792089237316195423570985008687907852589419931798687112530, "mulDiv vector"
        );
    }

    function testConstantProductExactInputPreservesInvariant() external pure {
        uint256 reserveIn = 1_000 ether;
        uint256 reserveOut = 2_000 ether;
        (uint256 amountOut, uint256 fee) =
            ConstantProductMath.quoteExactInput(10 ether, reserveIn, reserveOut, 3_000);
        require(fee == 0.03 ether, "fee rounding");
        require(amountOut == 19_743_160_687_941_225_977, "output vector");
        require(
            (reserveIn + 10 ether - fee) * (reserveOut - amountOut) >= reserveIn * reserveOut, "k"
        );
    }

    function testExactOutputRoundsAgainstTrader() external pure {
        (uint256 amountIn, uint256 fee) =
            ConstantProductMath.quoteExactOutput(20 ether, 1_000 ether, 2_000 ether, 3_000);
        require(amountIn == 10_131_404_313_951_956_882, "input vector");
        require(fee > 0, "fee");
    }

    function testBinZeroIsParity() external pure {
        require(BinPriceMath.priceFromBin(0, 25) == 1e18, "zero bin");
    }

    function testBinsAreMonotonicAndReciprocal() external pure {
        uint256 lower = BinPriceMath.priceFromBin(-10, 25);
        uint256 parity = BinPriceMath.priceFromBin(0, 25);
        uint256 upper = BinPriceMath.priceFromBin(10, 25);
        require(lower < parity && parity < upper, "monotonic");
        require(FullMath.mulDiv(lower, upper, 1e18) <= 1e18, "rounding direction");
    }
}

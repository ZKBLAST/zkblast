// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FullMath } from "./FullMath.sol";

/// @notice Deterministic constant-product quote math for public DAMM pools.
library ConstantProductMath {
    uint256 internal constant FEE_DENOMINATOR = 1_000_000;

    error EmptyReserve();
    error InvalidAmount();
    error InvalidFee();
    error InsufficientLiquidity();

    function quoteExactInput(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut,
        uint24 feePips
    ) internal pure returns (uint256 amountOut, uint256 feeAmount) {
        _validate(amountIn, reserveIn, reserveOut, feePips);
        feeAmount = FullMath.mulDivRoundingUp(amountIn, feePips, FEE_DENOMINATOR);
        uint256 netAmountIn = amountIn - feeAmount;
        amountOut = FullMath.mulDiv(netAmountIn, reserveOut, reserveIn + netAmountIn);
        if (amountOut == 0 || amountOut >= reserveOut) revert InsufficientLiquidity();
    }

    function quoteExactOutput(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut,
        uint24 feePips
    ) internal pure returns (uint256 amountIn, uint256 feeAmount) {
        _validate(amountOut, reserveIn, reserveOut, feePips);
        if (amountOut >= reserveOut) revert InsufficientLiquidity();
        uint256 netAmountIn =
            FullMath.mulDivRoundingUp(reserveIn, amountOut, reserveOut - amountOut);
        amountIn =
            FullMath.mulDivRoundingUp(netAmountIn, FEE_DENOMINATOR, FEE_DENOMINATOR - feePips);
        feeAmount = amountIn - netAmountIn;
    }

    function _validate(uint256 amount, uint256 reserveIn, uint256 reserveOut, uint24 feePips)
        private
        pure
    {
        if (amount == 0) revert InvalidAmount();
        if (reserveIn == 0 || reserveOut == 0) revert EmptyReserve();
        if (feePips >= FEE_DENOMINATOR) revert InvalidFee();
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Full-precision multiplication and division with explicit rounding.
library FullMath {
    error DivisionByZero();
    error MultiplicationOverflow();

    function mulDiv(uint256 x, uint256 y, uint256 denominator)
        internal
        pure
        returns (uint256 result)
    {
        if (denominator == 0) revert DivisionByZero();

        uint256 product0;
        uint256 product1;
        assembly ("memory-safe") {
            let mm := mulmod(x, y, not(0))
            product0 := mul(x, y)
            product1 := sub(sub(mm, product0), lt(mm, product0))
        }

        if (product1 == 0) return product0 / denominator;
        if (denominator <= product1) revert MultiplicationOverflow();

        uint256 remainder;
        assembly ("memory-safe") {
            remainder := mulmod(x, y, denominator)
            product1 := sub(product1, gt(remainder, product0))
            product0 := sub(product0, remainder)
        }

        uint256 twos = denominator & (~denominator + 1);
        assembly ("memory-safe") {
            denominator := div(denominator, twos)
            product0 := div(product0, twos)
            twos := add(div(sub(0, twos), twos), 1)
        }
        product0 |= product1 * twos;

        uint256 inverse = (3 * denominator) ^ 2;
        inverse *= 2 - denominator * inverse;
        inverse *= 2 - denominator * inverse;
        inverse *= 2 - denominator * inverse;
        inverse *= 2 - denominator * inverse;
        inverse *= 2 - denominator * inverse;
        inverse *= 2 - denominator * inverse;
        result = product0 * inverse;
    }

    function mulDivRoundingUp(uint256 x, uint256 y, uint256 denominator)
        internal
        pure
        returns (uint256 result)
    {
        result = mulDiv(x, y, denominator);
        if (mulmod(x, y, denominator) != 0) {
            if (result == type(uint256).max) revert MultiplicationOverflow();
            unchecked {
                ++result;
            }
        }
    }
}

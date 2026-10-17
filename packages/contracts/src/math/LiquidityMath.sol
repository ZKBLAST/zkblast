// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FullMath } from "./FullMath.sol";

library LiquidityMath {
    function minimum(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function proportionalShares(
        uint256 amount0,
        uint256 amount1,
        uint256 reserve0,
        uint256 reserve1,
        uint256 totalShares
    ) internal pure returns (uint256) {
        return minimum(
            FullMath.mulDiv(amount0, totalShares, reserve0),
            FullMath.mulDiv(amount1, totalShares, reserve1)
        );
    }

    function sqrt(uint256 value) internal pure returns (uint256 result) {
        if (value == 0) return 0;
        result = 2 ** (log2(value) >> 1);
        unchecked {
            for (uint256 i; i < 7; ++i) {
                result = (result + value / result) >> 1;
            }
            return minimum(result, value / result);
        }
    }

    function log2(uint256 value) private pure returns (uint256 result) {
        while (value > 1) {
            value >>= 1;
            unchecked {
                ++result;
            }
        }
    }
}

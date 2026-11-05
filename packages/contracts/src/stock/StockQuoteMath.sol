// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FullMath } from "../math/FullMath.sol";

/// @notice Explicit unit conversion helpers for stock-token quote accounting.
library StockQuoteMath {
    error InvalidScale();

    uint256 internal constant WAD = 1e18;

    /// @notice Converts raw token units into 18-decimal normalized units.
    /// @dev Rounds down so a quote path never promises value it has not received.
    function toWad(uint256 rawAmount, uint8 decimals) internal pure returns (uint256) {
        if (decimals > 36) revert InvalidScale();
        if (decimals == 18) return rawAmount;
        if (decimals < 18) return rawAmount * (10 ** (18 - decimals));
        return rawAmount / (10 ** (decimals - 18));
    }

    /// @notice Converts normalized units to raw token units with selectable upward rounding.
    function fromWad(uint256 wadAmount, uint8 decimals, bool roundUp)
        internal
        pure
        returns (uint256 rawAmount)
    {
        if (decimals > 36) revert InvalidScale();
        if (decimals == 18) return wadAmount;
        if (decimals > 18) return wadAmount * (10 ** (decimals - 18));
        uint256 divisor = 10 ** (18 - decimals);
        rawAmount = wadAmount / divisor;
        if (roundUp && wadAmount % divisor != 0) ++rawAmount;
    }

    /// @notice Returns USD notional in 18 decimals using a feed value and display multiplier.
    /// @param multiplierX18 Issuer display multiplier. Pass 1e18 when no adjustment applies.
    function usdNotionalX18(
        uint256 rawAmount,
        uint8 tokenDecimals,
        uint256 price,
        uint8 priceDecimals,
        uint256 multiplierX18
    ) internal pure returns (uint256) {
        if (price == 0 || multiplierX18 == 0 || priceDecimals > 36) {
            revert InvalidScale();
        }
        uint256 amountX18 = toWad(rawAmount, tokenDecimals);
        uint256 priceX18 = priceDecimals == 18
            ? price
            : priceDecimals < 18
                ? price * (10 ** (18 - priceDecimals))
                : price / (10 ** (priceDecimals - 18));
        return FullMath.mulDiv(FullMath.mulDiv(amountX18, priceX18, WAD), multiplierX18, WAD);
    }

    function mulDiv(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256) {
        return FullMath.mulDiv(x, y, denominator);
    }
}

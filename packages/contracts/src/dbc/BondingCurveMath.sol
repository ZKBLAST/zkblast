// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { FullMath } from "../math/FullMath.sol";
import { DbcTypes } from "./DbcTypes.sol";

/// @notice Fixed-point math for the first ZKBLAST DBC linear curve.
/// @dev Prices, sold inventory, and curve capacity use 18-decimal normalized units.
library BondingCurveMath {
    error CurveCapacityExceeded();
    error InvalidDecimals();
    error InvalidFee();
    error InvalidMathInput();
    error MathOverflow();

    struct FeeSplit {
        uint256 creator;
        uint256 partner;
        uint256 protocol;
    }

    function marginalPrice(DbcTypes.LinearSegment memory curve, uint256 soldX18)
        internal
        pure
        returns (uint256 priceX18)
    {
        _validateCurve(curve, soldX18);
        priceX18 =
            uint256(curve.initialPriceX18) + FullMath.mulDiv(curve.slopeX18, soldX18, DbcTypes.WAD);
        if (priceX18 > type(uint128).max) revert MathOverflow();
    }

    /// @notice Net quote required for an exact normalized base output.
    /// @dev Rounds up against the buyer.
    function quoteBuyExactBase(
        DbcTypes.LinearSegment memory curve,
        uint256 soldX18,
        uint256 baseOutX18
    ) internal pure returns (uint256 netQuoteX18) {
        if (baseOutX18 == 0) revert InvalidMathInput();
        uint256 capacity = curve.saleCapacityX18;
        if (soldX18 > capacity || baseOutX18 > capacity - soldX18) {
            revert CurveCapacityExceeded();
        }
        uint256 startPrice = marginalPrice(curve, soldX18);
        uint256 endPrice = marginalPrice(curve, soldX18 + baseOutX18);
        netQuoteX18 = _integralUp(baseOutX18, startPrice, endPrice);
    }

    /// @notice Gross quote returned before fees for an exact normalized base input.
    /// @dev Rounds down against the seller.
    function quoteSellExactBase(
        DbcTypes.LinearSegment memory curve,
        uint256 soldX18,
        uint256 baseInX18
    ) internal pure returns (uint256 grossQuoteX18) {
        if (baseInX18 == 0 || baseInX18 > soldX18) revert InvalidMathInput();
        uint256 startSold = soldX18 - baseInX18;
        uint256 startPrice = marginalPrice(curve, startSold);
        uint256 endPrice = marginalPrice(curve, soldX18);
        grossQuoteX18 = _integralDown(baseInX18, startPrice, endPrice);
    }

    /// @notice Maximum normalized base output purchasable by a net quote amount.
    /// @dev Uses the analytic inverse and adjusts at most one unit for integer rounding.
    function baseOutForNetQuote(
        DbcTypes.LinearSegment memory curve,
        uint256 soldX18,
        uint256 netQuoteX18
    ) internal pure returns (uint256 baseOutX18) {
        if (netQuoteX18 == 0) revert InvalidMathInput();
        uint256 capacity = curve.saleCapacityX18;
        if (soldX18 >= capacity) revert CurveCapacityExceeded();
        uint256 remaining = capacity - soldX18;
        uint256 startPrice = marginalPrice(curve, soldX18);
        uint256 slope = curve.slopeX18;

        if (slope == 0) {
            baseOutX18 = FullMath.mulDiv(netQuoteX18, DbcTypes.WAD, startPrice);
        } else {
            if (netQuoteX18 > type(uint128).max) revert MathOverflow();
            uint256 square = startPrice * startPrice;
            uint256 twiceSlope = slope * 2;
            if (netQuoteX18 > (type(uint256).max - square) / twiceSlope) {
                revert MathOverflow();
            }
            uint256 endPrice = Math.sqrt(square + twiceSlope * netQuoteX18);
            if (endPrice <= startPrice) return 0;
            baseOutX18 = FullMath.mulDiv(endPrice - startPrice, DbcTypes.WAD, slope);
        }

        if (baseOutX18 > remaining) baseOutX18 = remaining;
        if (baseOutX18 == 0) return 0;

        if (quoteBuyExactBase(curve, soldX18, baseOutX18) > netQuoteX18) {
            unchecked {
                --baseOutX18;
            }
        }
        if (baseOutX18 < remaining) {
            uint256 candidate = baseOutX18 + 1;
            if (quoteBuyExactBase(curve, soldX18, candidate) <= netQuoteX18) {
                baseOutX18 = candidate;
            }
        }
    }

    /// @notice Minimum normalized base input whose gross quote value reaches the target.
    function baseInForGrossQuote(
        DbcTypes.LinearSegment memory curve,
        uint256 soldX18,
        uint256 grossQuoteX18
    ) internal pure returns (uint256 baseInX18) {
        if (soldX18 == 0 || grossQuoteX18 == 0) revert InvalidMathInput();
        if (grossQuoteX18 > quoteSellExactBase(curve, soldX18, soldX18)) {
            revert CurveCapacityExceeded();
        }
        uint256 endPrice = marginalPrice(curve, soldX18);
        uint256 slope = curve.slopeX18;
        if (slope == 0) {
            baseInX18 = FullMath.mulDivRoundingUp(grossQuoteX18, DbcTypes.WAD, endPrice);
        } else {
            uint256 square = endPrice * endPrice;
            uint256 twiceSlope = slope * 2;
            if (grossQuoteX18 > square / twiceSlope) revert MathOverflow();
            uint256 startPrice = Math.sqrt(square - twiceSlope * grossQuoteX18);
            baseInX18 = FullMath.mulDivRoundingUp(endPrice - startPrice, DbcTypes.WAD, slope);
        }
        if (baseInX18 > soldX18) baseInX18 = soldX18;
        if (baseInX18 > 1 && quoteSellExactBase(curve, soldX18, baseInX18 - 1) >= grossQuoteX18) {
            --baseInX18;
        }
        if (quoteSellExactBase(curve, soldX18, baseInX18) < grossQuoteX18) {
            ++baseInX18;
        }
    }

    function feeOnGross(uint256 grossAmount, uint16 feeBps) internal pure returns (uint256) {
        if (feeBps > DbcTypes.MAX_TRADE_FEE_BPS) revert InvalidFee();
        return FullMath.mulDiv(grossAmount, feeBps, DbcTypes.BPS);
    }

    function splitFee(uint256 feeAmount, DbcTypes.FeePolicy memory policy)
        internal
        pure
        returns (FeeSplit memory split)
    {
        if (
            policy.tradeFeeBps > DbcTypes.MAX_TRADE_FEE_BPS
                || uint256(policy.creatorShareBps) + policy.partnerShareBps
                        + policy.protocolShareBps != DbcTypes.BPS
        ) revert InvalidFee();
        split.creator = FullMath.mulDiv(feeAmount, policy.creatorShareBps, DbcTypes.BPS);
        split.partner = FullMath.mulDiv(feeAmount, policy.partnerShareBps, DbcTypes.BPS);
        split.protocol = feeAmount - split.creator - split.partner;
    }

    function normalizeToX18(uint256 rawAmount, uint8 decimals) internal pure returns (uint256) {
        if (decimals > 18) revert InvalidDecimals();
        uint256 factor = 10 ** (18 - decimals);
        if (rawAmount > type(uint256).max / factor) revert MathOverflow();
        return rawAmount * factor;
    }

    function denormalizeDown(uint256 amountX18, uint8 decimals) internal pure returns (uint256) {
        if (decimals > 18) revert InvalidDecimals();
        return amountX18 / 10 ** (18 - decimals);
    }

    function denormalizeUp(uint256 amountX18, uint8 decimals)
        internal
        pure
        returns (uint256 rawAmount)
    {
        if (decimals > 18) revert InvalidDecimals();
        uint256 factor = 10 ** (18 - decimals);
        rawAmount = amountX18 / factor;
        if (amountX18 % factor != 0) ++rawAmount;
    }

    function _integralDown(uint256 baseAmountX18, uint256 startPrice, uint256 endPrice)
        private
        pure
        returns (uint256)
    {
        if (startPrice > type(uint256).max - endPrice) revert MathOverflow();
        return FullMath.mulDiv(baseAmountX18, startPrice + endPrice, 2 * DbcTypes.WAD);
    }

    function _integralUp(uint256 baseAmountX18, uint256 startPrice, uint256 endPrice)
        private
        pure
        returns (uint256)
    {
        if (startPrice > type(uint256).max - endPrice) revert MathOverflow();
        return FullMath.mulDivRoundingUp(baseAmountX18, startPrice + endPrice, 2 * DbcTypes.WAD);
    }

    function _validateCurve(DbcTypes.LinearSegment memory curve, uint256 soldX18) private pure {
        if (
            curve.initialPriceX18 == 0 || curve.saleCapacityX18 == 0
                || soldX18 > curve.saleCapacityX18
        ) revert InvalidMathInput();
    }
}

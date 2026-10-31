// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FullMath } from "../math/FullMath.sol";
import { BondingCurveMath } from "./BondingCurveMath.sol";
import { DbcTypes } from "./DbcTypes.sol";

/// @notice Bounded traversal for continuous piecewise-linear DBC curves.
library SegmentedBondingCurveMath {
    error CurveCapacityExceeded();
    error DiscontinuousCurve();
    error InvalidCurve();
    error InvalidMathInput();

    function validate(DbcTypes.CurveConfig memory curve)
        internal
        pure
        returns (uint256 totalCapacityX18)
    {
        uint256 count = curve.segmentCount;
        if (count == 0 || count > DbcTypes.MAX_CURVE_SEGMENTS) revert InvalidCurve();
        uint256 expectedStart;
        for (uint256 index; index < count; ++index) {
            DbcTypes.LinearSegment memory segment = curve.segments[index];
            if (segment.initialPriceX18 == 0 || segment.saleCapacityX18 == 0) {
                revert InvalidCurve();
            }
            if (index != 0 && segment.initialPriceX18 != expectedStart) {
                revert DiscontinuousCurve();
            }
            expectedStart = BondingCurveMath.marginalPrice(segment, segment.saleCapacityX18);
            totalCapacityX18 += segment.saleCapacityX18;
        }
    }

    function marginalPrice(DbcTypes.CurveConfig memory curve, uint256 soldX18)
        internal
        pure
        returns (uint256)
    {
        uint256 totalCapacity = validate(curve);
        if (soldX18 > totalCapacity) revert CurveCapacityExceeded();
        (uint256 index, uint256 localSold) = _locate(curve, soldX18);
        return BondingCurveMath.marginalPrice(curve.segments[index], localSold);
    }

    function quoteBuyExactBase(
        DbcTypes.CurveConfig memory curve,
        uint256 soldX18,
        uint256 baseOutX18
    ) internal pure returns (uint256 netQuoteX18) {
        if (baseOutX18 == 0) revert InvalidMathInput();
        uint256 totalCapacity = validate(curve);
        if (soldX18 > totalCapacity || baseOutX18 > totalCapacity - soldX18) {
            revert CurveCapacityExceeded();
        }
        netQuoteX18 = _integrate(curve, soldX18, baseOutX18, true);
    }

    function quoteSellExactBase(
        DbcTypes.CurveConfig memory curve,
        uint256 soldX18,
        uint256 baseInX18
    ) internal pure returns (uint256 grossQuoteX18) {
        if (baseInX18 == 0 || baseInX18 > soldX18) revert InvalidMathInput();
        validate(curve);
        grossQuoteX18 = _integrate(curve, soldX18 - baseInX18, baseInX18, false);
    }

    function baseOutForNetQuote(
        DbcTypes.CurveConfig memory curve,
        uint256 soldX18,
        uint256 netQuoteX18
    ) internal pure returns (uint256 baseOutX18) {
        if (netQuoteX18 == 0) revert InvalidMathInput();
        uint256 totalCapacity = validate(curve);
        if (soldX18 >= totalCapacity) revert CurveCapacityExceeded();
        uint256 quoteRemaining = netQuoteX18;
        uint256 cursor = soldX18;
        uint256 count = curve.segmentCount;
        for (uint256 traversed; traversed < count && quoteRemaining != 0; ++traversed) {
            (uint256 index, uint256 localSold) = _locate(curve, cursor);
            DbcTypes.LinearSegment memory segment = curve.segments[index];
            uint256 localRemaining = uint256(segment.saleCapacityX18) - localSold;
            uint256 fullCost =
                BondingCurveMath.quoteBuyExactBase(segment, localSold, localRemaining);
            if (fullCost <= quoteRemaining) {
                baseOutX18 += localRemaining;
                cursor += localRemaining;
                quoteRemaining -= fullCost;
                if (cursor == totalCapacity) break;
                continue;
            }
            baseOutX18 += BondingCurveMath.baseOutForNetQuote(segment, localSold, quoteRemaining);
            break;
        }
        if (baseOutX18 == 0) return 0;
        if (quoteBuyExactBase(curve, soldX18, baseOutX18) > netQuoteX18) {
            unchecked {
                --baseOutX18;
            }
        }
        if (baseOutX18 < totalCapacity - soldX18) {
            uint256 candidate = baseOutX18 + 1;
            if (quoteBuyExactBase(curve, soldX18, candidate) <= netQuoteX18) {
                baseOutX18 = candidate;
            }
        }
    }

    function baseInForGrossQuote(
        DbcTypes.CurveConfig memory curve,
        uint256 soldX18,
        uint256 grossQuoteX18
    ) internal pure returns (uint256 baseInX18) {
        if (soldX18 == 0 || grossQuoteX18 == 0) revert InvalidMathInput();
        validate(curve);
        if (grossQuoteX18 > quoteSellExactBase(curve, soldX18, soldX18)) {
            revert CurveCapacityExceeded();
        }
        uint256 quoteRemaining = grossQuoteX18;
        uint256 cursor = soldX18;
        uint256 count = curve.segmentCount;
        for (uint256 traversed; traversed < count && quoteRemaining != 0; ++traversed) {
            (uint256 index, uint256 localSold) = _locateForSell(curve, cursor);
            DbcTypes.LinearSegment memory segment = curve.segments[index];
            uint256 fullQuote = BondingCurveMath.quoteSellExactBase(segment, localSold, localSold);
            if (fullQuote <= quoteRemaining) {
                baseInX18 += localSold;
                cursor -= localSold;
                quoteRemaining -= fullQuote;
                continue;
            }
            baseInX18 += BondingCurveMath.baseInForGrossQuote(segment, localSold, quoteRemaining);
            break;
        }
        if (baseInX18 > 1 && quoteSellExactBase(curve, soldX18, baseInX18 - 1) >= grossQuoteX18) {
            --baseInX18;
        }
        if (quoteSellExactBase(curve, soldX18, baseInX18) < grossQuoteX18) {
            ++baseInX18;
        }
    }

    function _integrate(
        DbcTypes.CurveConfig memory curve,
        uint256 startSoldX18,
        uint256 baseAmountX18,
        bool roundUp
    ) private pure returns (uint256 quoteX18) {
        uint256 denominator = 2 * DbcTypes.WAD;
        uint256 remainder;
        uint256 cursor = startSoldX18;
        uint256 remaining = baseAmountX18;
        uint256 count = curve.segmentCount;
        for (uint256 traversed; traversed < count && remaining != 0; ++traversed) {
            (uint256 index, uint256 localSold) = _locate(curve, cursor);
            DbcTypes.LinearSegment memory segment = curve.segments[index];
            uint256 amount = _min(remaining, uint256(segment.saleCapacityX18) - localSold);
            uint256 startPrice = BondingCurveMath.marginalPrice(segment, localSold);
            uint256 endPrice = BondingCurveMath.marginalPrice(segment, localSold + amount);
            uint256 priceSum = startPrice + endPrice;
            quoteX18 += FullMath.mulDiv(amount, priceSum, denominator);
            remainder += mulmod(amount, priceSum, denominator);
            quoteX18 += remainder / denominator;
            remainder %= denominator;
            cursor += amount;
            remaining -= amount;
        }
        if (remaining != 0) revert CurveCapacityExceeded();
        if (roundUp && remainder != 0) ++quoteX18;
    }

    function _locate(DbcTypes.CurveConfig memory curve, uint256 soldX18)
        private
        pure
        returns (uint256 index, uint256 localSoldX18)
    {
        uint256 remaining = soldX18;
        uint256 count = curve.segmentCount;
        for (; index < count; ++index) {
            uint256 capacity = curve.segments[index].saleCapacityX18;
            if (remaining < capacity || (remaining == capacity && index + 1 == count)) {
                return (index, remaining);
            }
            remaining -= capacity;
        }
        revert CurveCapacityExceeded();
    }

    function _locateForSell(DbcTypes.CurveConfig memory curve, uint256 soldX18)
        private
        pure
        returns (uint256 index, uint256 localSoldX18)
    {
        uint256 remaining = soldX18;
        uint256 count = curve.segmentCount;
        for (; index < count; ++index) {
            uint256 capacity = curve.segments[index].saleCapacityX18;
            if (remaining <= capacity) return (index, remaining);
            remaining -= capacity;
        }
        revert CurveCapacityExceeded();
    }

    function _min(uint256 left, uint256 right) private pure returns (uint256) {
        return left < right ? left : right;
    }
}

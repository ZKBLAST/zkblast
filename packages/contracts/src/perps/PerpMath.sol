// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FullMath } from "../math/FullMath.sol";
import { PerpTypes } from "./PerpTypes.sol";

library PerpMath {
    error InvalidMathInput();
    error SignedOverflow();

    uint256 internal constant PRICE_SCALE = 1e18;
    uint256 internal constant BASE_CONVERSION = 1e30;

    function notional(uint256 marginUsd, uint32 leverageBps) internal pure returns (uint256) {
        if (
            marginUsd == 0 || leverageBps < PerpTypes.BPS
                || leverageBps > PerpTypes.MAX_LEVERAGE_BPS
        ) revert InvalidMathInput();
        return FullMath.mulDiv(marginUsd, leverageBps, PerpTypes.BPS);
    }

    function baseSize(uint256 notionalUsd, uint256 priceX18) internal pure returns (uint256) {
        if (notionalUsd == 0 || priceX18 == 0) revert InvalidMathInput();
        return FullMath.mulDiv(notionalUsd, BASE_CONVERSION, priceX18);
    }

    function notionalFromBase(uint256 positionBaseSize, uint256 priceX18)
        internal
        pure
        returns (uint256)
    {
        if (positionBaseSize == 0 || priceX18 == 0) revert InvalidMathInput();
        return FullMath.mulDiv(positionBaseSize, priceX18, BASE_CONVERSION);
    }

    function fee(uint256 notionalUsd, uint16 feeBps) internal pure returns (uint256) {
        if (feeBps >= PerpTypes.BPS) revert InvalidMathInput();
        return FullMath.mulDivRoundingUp(notionalUsd, feeBps, PerpTypes.BPS);
    }

    function requiredMargin(uint256 notionalUsd, uint32 leverageBps)
        internal
        pure
        returns (uint256)
    {
        if (
            notionalUsd == 0 || leverageBps < PerpTypes.BPS
                || leverageBps > PerpTypes.MAX_LEVERAGE_BPS
        ) revert InvalidMathInput();
        return FullMath.mulDivRoundingUp(notionalUsd, PerpTypes.BPS, leverageBps);
    }

    function maintenanceMargin(uint256 notionalUsd, uint16 maintenanceMarginBps)
        internal
        pure
        returns (uint256)
    {
        if (notionalUsd == 0 || maintenanceMarginBps == 0 || maintenanceMarginBps >= PerpTypes.BPS)
        {
            revert InvalidMathInput();
        }
        return FullMath.mulDivRoundingUp(notionalUsd, maintenanceMarginBps, PerpTypes.BPS);
    }

    function pnl(bool isLong, uint256 positionBaseSize, uint256 entryPriceX18, uint256 priceX18)
        internal
        pure
        returns (int256)
    {
        if (
            positionBaseSize == 0 || entryPriceX18 == 0 || priceX18 == 0
                || positionBaseSize > uint256(type(int256).max)
                || entryPriceX18 > uint256(type(int256).max) || priceX18 > uint256(type(int256).max)
        ) revert InvalidMathInput();

        int256 delta = int256(priceX18) - int256(entryPriceX18);
        if (!isLong) delta = -delta;
        uint256 absoluteDelta = uint256(delta < 0 ? -delta : delta);
        uint256 absolutePnl = FullMath.mulDiv(positionBaseSize, absoluteDelta, BASE_CONVERSION);
        if (absolutePnl > uint256(type(int256).max)) revert SignedOverflow();
        return delta < 0 ? -int256(absolutePnl) : int256(absolutePnl);
    }

    function equity(uint256 collateralUsd, int256 unrealizedPnl, int256 accruedFunding)
        internal
        pure
        returns (int256)
    {
        if (collateralUsd > uint256(type(int256).max)) revert InvalidMathInput();
        return int256(collateralUsd) + unrealizedPnl - accruedFunding;
    }

    function isLiquidatable(
        uint256 collateralUsd,
        int256 unrealizedPnl,
        int256 accruedFunding,
        uint256 maintenanceUsd
    ) internal pure returns (bool) {
        if (maintenanceUsd > uint256(type(int256).max)) {
            revert InvalidMathInput();
        }
        return equity(collateralUsd, unrealizedPnl, accruedFunding) <= int256(maintenanceUsd);
    }

    function skew(uint256 longOpenInterestUsd, uint256 shortOpenInterestUsd)
        internal
        pure
        returns (int256)
    {
        if (
            longOpenInterestUsd > uint256(type(int256).max)
                || shortOpenInterestUsd > uint256(type(int256).max)
        ) revert InvalidMathInput();
        return int256(longOpenInterestUsd) - int256(shortOpenInterestUsd);
    }

    function utilizationBps(uint256 reservedUsd, uint256 vaultAssetsUsd)
        internal
        pure
        returns (uint256)
    {
        if (vaultAssetsUsd == 0) revert InvalidMathInput();
        return FullMath.mulDivRoundingUp(reservedUsd, PerpTypes.BPS, vaultAssetsUsd);
    }

    function priceImpactBps(
        int256 postTradeSkewUsd,
        uint256 maxOpenInterestUsd,
        uint16 maxImpactBps
    ) internal pure returns (uint256) {
        if (maxOpenInterestUsd == 0 || maxImpactBps >= PerpTypes.BPS) {
            revert InvalidMathInput();
        }
        uint256 absoluteSkew = uint256(postTradeSkewUsd < 0 ? -postTradeSkewUsd : postTradeSkewUsd);
        uint256 impact = FullMath.mulDiv(absoluteSkew, maxImpactBps, maxOpenInterestUsd);
        return impact > maxImpactBps ? maxImpactBps : impact;
    }

    function executionPrice(uint256 indexPriceX18, bool isLong, uint256 impactBps)
        internal
        pure
        returns (uint256)
    {
        if (indexPriceX18 == 0 || impactBps >= PerpTypes.BPS) revert InvalidMathInput();
        if (isLong) {
            return
                FullMath.mulDivRoundingUp(indexPriceX18, PerpTypes.BPS + impactBps, PerpTypes.BPS);
        }
        return FullMath.mulDiv(indexPriceX18, PerpTypes.BPS - impactBps, PerpTypes.BPS);
    }

    function fundingPayment(uint256 notionalUsd, int32 rateBpsPerHour, uint256 elapsedSeconds)
        internal
        pure
        returns (int256)
    {
        if (notionalUsd > uint256(type(int256).max)) revert InvalidMathInput();
        uint256 absoluteRate =
            uint256(rateBpsPerHour < 0 ? -int256(rateBpsPerHour) : int256(rateBpsPerHour));
        uint256 payment = FullMath.mulDiv(
            FullMath.mulDiv(notionalUsd, absoluteRate, PerpTypes.BPS), elapsedSeconds, 1 hours
        );
        if (payment > uint256(type(int256).max)) revert SignedOverflow();
        return rateBpsPerHour < 0 ? -int256(payment) : int256(payment);
    }

    function fundingFromIndex(uint256 notionalUsd, int256 indexDeltaX18, bool isLong)
        internal
        pure
        returns (int256)
    {
        uint256 absoluteDelta = uint256(indexDeltaX18 < 0 ? -indexDeltaX18 : indexDeltaX18);
        uint256 absolutePayment = FullMath.mulDiv(notionalUsd, absoluteDelta, PRICE_SCALE);
        if (absolutePayment > uint256(type(int256).max)) revert SignedOverflow();
        int256 payment = indexDeltaX18 < 0 ? -int256(absolutePayment) : int256(absolutePayment);
        return isLong ? payment : -payment;
    }
}

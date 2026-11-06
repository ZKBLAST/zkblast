// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { BinPriceMath } from "./BinPriceMath.sol";
import { FullMath } from "./FullMath.sol";

library DlmmV2LiquidityMath {
    uint256 internal constant PRICE_SCALE = 1e18;
    uint256 internal constant MAX_BATCH_BINS = 61;

    error InvalidAssetSide();
    error InvalidBatch();
    error InvalidDecimals();
    error StaleActiveBin();
    error ZeroLiquidityValue();

    function validateDeposit(
        int24 binId,
        int24 activeBin,
        int24 expectedActiveBin,
        uint256 amount0,
        uint256 amount1
    ) internal pure {
        if (activeBin != expectedActiveBin) revert StaleActiveBin();
        if (amount0 == 0 && amount1 == 0) revert ZeroLiquidityValue();
        if (binId < activeBin && (amount0 != 0 || amount1 == 0)) revert InvalidAssetSide();
        if (binId > activeBin && (amount0 == 0 || amount1 != 0)) revert InvalidAssetSide();
    }

    function validateOrderedBins(int24[] calldata binIds) internal pure {
        uint256 length = binIds.length;
        if (length == 0 || length > MAX_BATCH_BINS) revert InvalidBatch();
        for (uint256 index = 0; index < length; ++index) {
            int24 binId = binIds[index];
            if (binId < -10_000 || binId > 10_000) revert InvalidBatch();
            if (index != 0 && binIds[index - 1] >= binId) revert InvalidBatch();
        }
    }

    function token1Value(
        uint256 amount0,
        uint256 amount1,
        uint256 priceX18,
        uint8 decimals0,
        uint8 decimals1
    ) internal pure returns (uint256 value) {
        if (decimals0 > 36 || decimals1 > 36) revert InvalidDecimals();
        uint256 converted0 = FullMath.mulDiv(amount0, priceX18, PRICE_SCALE);
        if (decimals1 > decimals0) {
            converted0 = FullMath.mulDiv(converted0, 10 ** uint256(decimals1 - decimals0), 1);
        } else if (decimals0 > decimals1) {
            converted0 /= 10 ** uint256(decimals0 - decimals1);
        }
        value = amount1 + converted0;
        if (value == 0) revert ZeroLiquidityValue();
    }

    function mintedShares(
        uint256 depositValue,
        uint256 binValueBefore,
        uint256 totalShares,
        uint256 minimumLockedLiquidity
    ) internal pure returns (uint256 userShares, uint256 lockedShares) {
        if (depositValue == 0) revert ZeroLiquidityValue();
        if (totalShares == 0) {
            if (depositValue <= minimumLockedLiquidity) revert ZeroLiquidityValue();
            return (depositValue - minimumLockedLiquidity, minimumLockedLiquidity);
        }
        if (binValueBefore == 0) revert ZeroLiquidityValue();
        userShares = FullMath.mulDiv(depositValue, totalShares, binValueBefore);
        if (userShares == 0) revert ZeroLiquidityValue();
    }

    function price(int24 binId, uint16 binStepBps) internal pure returns (uint256) {
        return BinPriceMath.priceFromBin(binId, binStepBps);
    }
}

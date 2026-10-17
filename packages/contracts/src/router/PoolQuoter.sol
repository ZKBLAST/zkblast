// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DammPool } from "../core/DammPool.sol";
import { DlmmPool } from "../core/DlmmPool.sol";
import { PoolModel } from "../core/PoolTypes.sol";
import { BinPriceMath } from "../math/BinPriceMath.sol";
import { ConstantProductMath } from "../math/ConstantProductMath.sol";
import { FullMath } from "../math/FullMath.sol";

contract PoolQuoter {
    uint256 private constant FEE_DENOMINATOR = 1_000_000;

    error InsufficientLiquidity();
    error TraversalLimitReached();

    function quoteDammExactInput(DammPool pool, address tokenIn, uint256 amountIn)
        external
        view
        returns (uint256 amountOut, uint256 feeAmount)
    {
        bool zeroForOne = tokenIn == pool.token0();
        if (!zeroForOne && tokenIn != pool.token1()) revert InsufficientLiquidity();
        (uint256 reserveIn, uint256 reserveOut) = zeroForOne
            ? (uint256(pool.reserve0()), uint256(pool.reserve1()))
            : (uint256(pool.reserve1()), uint256(pool.reserve0()));
        return ConstantProductMath.quoteExactInput(amountIn, reserveIn, reserveOut, pool.feePips());
    }

    function quoteDlmmExactInput(
        DlmmPool pool,
        bool token0ToToken1,
        uint256 amountIn,
        uint16 maximumBinCrossings
    ) external view returns (uint256 amountOut, int24 finalBin, uint16 binsCrossed) {
        uint256 remaining = amountIn;
        finalBin = pool.activeBin();
        uint24 feePips = pool.feePips();
        for (; binsCrossed < maximumBinCrossings && remaining != 0; ++binsCrossed) {
            (uint256 consumed, uint256 output) =
                _quoteBin(pool, finalBin, token0ToToken1, remaining, feePips);
            remaining -= consumed;
            amountOut += output;
            if (remaining != 0) finalBin = token0ToToken1 ? finalBin - 1 : finalBin + 1;
        }
        if (remaining != 0) revert TraversalLimitReached();
        if (amountOut == 0) revert InsufficientLiquidity();
    }

    function _quoteBin(
        DlmmPool pool,
        int24 binId,
        bool token0ToToken1,
        uint256 availableInput,
        uint24 feePips
    ) private view returns (uint256 consumed, uint256 output) {
        (uint128 reserve0, uint128 reserve1,, uint256 priceX18) = pool.binState(binId);
        uint256 outputReserve = token0ToToken1 ? reserve1 : reserve0;
        if (outputReserve == 0) return (0, 0);
        uint256 fee = FullMath.mulDivRoundingUp(availableInput, feePips, FEE_DENOMINATOR);
        uint256 netInput = availableInput - fee;
        output = BinPriceMath.quoteAtPrice(netInput, priceX18, token0ToToken1);
        consumed = availableInput;
        if (output > outputReserve) {
            output = outputReserve;
            netInput = token0ToToken1
                ? FullMath.mulDivRoundingUp(output, 1e18, priceX18)
                : FullMath.mulDivRoundingUp(output, priceX18, 1e18);
            consumed =
                FullMath.mulDivRoundingUp(netInput, FEE_DENOMINATOR, FEE_DENOMINATOR - feePips);
        }
    }
}

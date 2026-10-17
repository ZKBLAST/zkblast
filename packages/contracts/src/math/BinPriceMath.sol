// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FullMath } from "./FullMath.sol";

/// @notice Price conversion helpers for discrete public DLMM bins.
library BinPriceMath {
    uint256 internal constant SCALE = 1e18;
    uint16 internal constant MAX_BIN_STEP_BPS = 1_000;

    error InvalidBinStep();
    error BinOutOfRange();

    function priceFromBin(int24 binId, uint16 binStepBps) internal pure returns (uint256 priceX18) {
        if (binStepBps == 0 || binStepBps > MAX_BIN_STEP_BPS) revert InvalidBinStep();
        if (binId < -10_000 || binId > 10_000) revert BinOutOfRange();

        uint256 baseX18 = SCALE + uint256(binStepBps) * 1e14;
        // forge-lint: disable-next-line(unsafe-typecast)
        if (binId >= 0) return _powX18(baseX18, uint24(binId));
        // The ±10,000 bound above makes negation and uint24 conversion safe.
        // forge-lint: disable-next-line(unsafe-typecast)
        return FullMath.mulDiv(SCALE, SCALE, _powX18(baseX18, uint24(-binId)));
    }

    function quoteAtPrice(uint256 amountIn, uint256 priceX18, bool token0ToToken1)
        internal
        pure
        returns (uint256 amountOut)
    {
        if (token0ToToken1) return FullMath.mulDiv(amountIn, priceX18, SCALE);
        return FullMath.mulDiv(amountIn, SCALE, priceX18);
    }

    function _powX18(uint256 baseX18, uint24 exponent) private pure returns (uint256 result) {
        result = SCALE;
        while (exponent != 0) {
            if (exponent & 1 != 0) result = FullMath.mulDiv(result, baseX18, SCALE);
            exponent >>= 1;
            if (exponent != 0) baseX18 = FullMath.mulDiv(baseX18, baseX18, SCALE);
        }
    }
}

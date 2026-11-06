// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DlmmPool } from "../core/DlmmPool.sol";

/// @notice Bounded, stateless DLMM bin reader for indexers and interfaces.
contract DlmmLens {
    uint256 public constant MAX_BINS = 121;
    int24 public constant MIN_BIN = -10_000;
    int24 public constant MAX_BIN = 10_000;

    struct BinView {
        int24 binId;
        uint128 reserve0;
        uint128 reserve1;
        uint256 totalShares;
        uint256 priceX18;
    }

    error InvalidPool();
    error InvalidRange();
    error RangeTooWide();

    function getBins(DlmmPool pool, int24 lower, int24 upper, bool skipEmpty)
        external
        view
        returns (int24 activeBin, BinView[] memory bins)
    {
        if (address(pool).code.length == 0) revert InvalidPool();
        if (lower < MIN_BIN || upper > MAX_BIN || lower > upper) revert InvalidRange();
        uint256 count = uint256(int256(upper) - int256(lower) + 1);
        if (count > MAX_BINS) revert RangeTooWide();

        activeBin = pool.activeBin();
        bins = new BinView[](count);
        uint256 written;
        for (int256 cursor = lower; cursor <= upper; ++cursor) {
            int24 binId = int24(cursor);
            (uint128 reserve0, uint128 reserve1, uint256 totalShares, uint256 priceX18) =
                pool.binState(binId);
            if (skipEmpty && totalShares == 0) continue;
            bins[written++] = BinView(binId, reserve0, reserve1, totalShares, priceX18);
        }
        assembly ("memory-safe") {
            mstore(bins, written)
        }
    }

    function getActiveRange(DlmmPool pool, uint24 radius, bool skipEmpty)
        external
        view
        returns (int24 activeBin, BinView[] memory bins)
    {
        if (address(pool).code.length == 0) revert InvalidPool();
        if (uint256(radius) * 2 + 1 > MAX_BINS) revert RangeTooWide();
        activeBin = pool.activeBin();
        int256 lowerRaw = int256(activeBin) - int256(uint256(radius));
        int256 upperRaw = int256(activeBin) + int256(uint256(radius));
        if (lowerRaw < MIN_BIN || upperRaw > MAX_BIN) revert InvalidRange();
        return this.getBins(pool, int24(lowerRaw), int24(upperRaw), skipEmpty);
    }
}

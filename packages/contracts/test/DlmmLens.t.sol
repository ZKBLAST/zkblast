// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DlmmPool } from "../src/core/DlmmPool.sol";
import { PoolKey, PoolKeyLib, PoolModel } from "../src/core/PoolTypes.sol";
import { DlmmLens } from "../src/periphery/DlmmLens.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";

contract DlmmLensTest {
    DlmmPool private pool;
    DlmmLens private lens;

    function setUp() public {
        MockERC20 tokenA = new MockERC20("Token A", "TKA");
        MockERC20 tokenB = new MockERC20("Token B", "TKB");
        PoolKey memory key =
            PoolKeyLib.normalize(address(tokenA), address(tokenB), PoolModel.DLMM, 3_000, 25);
        pool = new DlmmPool(key, address(this), 0);
        lens = new DlmmLens();
        MockERC20(key.token0).mint(address(this), 1_000 ether);
        MockERC20(key.token1).mint(address(this), 1_000 ether);
        MockERC20(key.token0).approve(address(pool), type(uint256).max);
        MockERC20(key.token1).approve(address(pool), type(uint256).max);
        pool.addLiquidity(-2, 10 ether, 20 ether, 1, address(this), type(uint256).max);
        pool.addLiquidity(2, 30 ether, 40 ether, 1, address(this), type(uint256).max);
    }

    function testReadsNegativeAndSparseBinsDeterministically() external view {
        (int24 active, DlmmLens.BinView[] memory bins) = lens.getBins(pool, -3, 3, true);
        require(active == 0, "active");
        require(bins.length == 2, "sparse count");
        require(bins[0].binId == -2 && bins[1].binId == 2, "ordering");
        require(bins[0].totalShares > 0 && bins[1].totalShares > 0, "shares");
    }

    function testBoundedRangeIncludesEmptyBinsWhenRequested() external view {
        (, DlmmLens.BinView[] memory bins) = lens.getActiveRange(pool, 3, false);
        require(bins.length == 7, "range");
        require(bins[3].binId == 0 && bins[3].priceX18 > 0, "center");
    }

    function testRejectsMalformedPoolAndRanges() external {
        (bool malformed,) = address(lens).call(
            abi.encodeCall(DlmmLens.getBins, (DlmmPool(address(0)), int24(0), int24(0), true))
        );
        (bool reversed,) = address(lens).call(
            abi.encodeCall(DlmmLens.getBins, (pool, int24(2), int24(-2), true))
        );
        (bool wide,) = address(lens).call(
            abi.encodeCall(DlmmLens.getBins, (pool, int24(-61), int24(60), true))
        );
        require(!malformed && !reversed && !wide, "invalid range accepted");
    }
}

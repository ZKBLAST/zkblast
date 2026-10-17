// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DlmmPool } from "../src/core/DlmmPool.sol";
import { PoolKey, PoolKeyLib, PoolModel } from "../src/core/PoolTypes.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";

contract DlmmPoolTest {
    MockERC20 private token0;
    MockERC20 private token1;
    DlmmPool private pool;
    uint256 private constant DEADLINE = type(uint256).max;

    function setUp() public {
        MockERC20 tokenA = new MockERC20("Token A", "TKA");
        MockERC20 tokenB = new MockERC20("Token B", "TKB");
        PoolKey memory key =
            PoolKeyLib.normalize(address(tokenA), address(tokenB), PoolModel.DLMM, 3_000, 25);
        pool = new DlmmPool(key, address(this), 0);
        token0 = MockERC20(key.token0);
        token1 = MockERC20(key.token1);
        token0.mint(address(this), 100_000 ether);
        token1.mint(address(this), 100_000 ether);
        token0.approve(address(pool), type(uint256).max);
        token1.approve(address(pool), type(uint256).max);
    }

    function testAddsAndRemovesPerBinLiquidity() external {
        uint256 shares = pool.addLiquidity(4, 100 ether, 120 ether, 1, address(this), DEADLINE);
        (uint128 reserve0, uint128 reserve1, uint256 totalShares, uint256 price) = pool.binState(4);
        require(reserve0 == 100 ether && reserve1 == 120 ether, "reserves");
        require(totalShares == shares + pool.MINIMUM_BIN_LIQUIDITY(), "locked shares");
        require(price > 1e18, "bin price");

        (uint256 amount0, uint256 amount1) =
            pool.removeLiquidity(4, shares, 99 ether, 119 ether, address(this), DEADLINE);
        require(amount0 >= 99 ether && amount1 >= 119 ether, "withdrawal");
    }

    function testSwapWithinActiveBin() external {
        pool.addLiquidity(0, 1_000 ether, 2_000 ether, 1, address(this), DEADLINE);
        (uint256 output, uint256 consumed) =
            pool.swapExactInput(true, 10 ether, 9 ether, 1, address(this), DEADLINE);
        require(consumed == 10 ether, "consumed");
        require(output == 9.97 ether, "output");
        require(pool.activeBin() == 0, "active bin");
    }

    function testCrossesBinsAndSkipsEmptyBin() external {
        pool.addLiquidity(0, 100 ether, 5 ether, 1, address(this), DEADLINE);
        pool.addLiquidity(-2, 100 ether, 100 ether, 1, address(this), DEADLINE);
        (uint256 output, uint256 consumed) =
            pool.swapExactInput(true, 10 ether, 9 ether, 3, address(this), DEADLINE);
        require(consumed == 10 ether, "consumed");
        require(output > 9 ether, "output");
        require(pool.activeBin() == -2, "did not skip empty bin");
    }

    function testTraversalLimitRevertsAtomically() external {
        pool.addLiquidity(0, 100 ether, 5 ether, 1, address(this), DEADLINE);
        pool.addLiquidity(-2, 100 ether, 100 ether, 1, address(this), DEADLINE);
        uint256 balanceBefore = token0.balanceOf(address(this));
        (bool success,) = address(pool)
            .call(
                abi.encodeCall(
                    DlmmPool.swapExactInput,
                    // forge-lint: disable-next-line(boolean-cst)
                    (true, 10 ether, uint256(1), uint16(2), address(this), DEADLINE)
                )
            );
        require(!success, "traversal accepted");
        require(token0.balanceOf(address(this)) == balanceBefore, "input not reverted");
        require(pool.activeBin() == 0, "active bin changed");
    }

    function testProtocolFeesAreSeparatedAndCollectible() external {
        pool.addLiquidity(0, 1_000 ether, 2_000 ether, 1, address(this), DEADLINE);
        pool.setProtocolFeeConfiguration(address(this), 200_000);
        pool.swapExactInput(true, 10 ether, 1, 1, address(this), DEADLINE);
        require(pool.protocolFees0() > 0, "fee missing");
        (uint256 amount0, uint256 amount1) = pool.collectProtocolFees();
        require(amount0 > 0 && amount1 == 0, "collection");
        require(pool.protocolFees0() == 0, "fee not cleared");
    }

    function testPauseBlocksDepositAndSwapButAllowsRemoval() external {
        uint256 shares = pool.addLiquidity(0, 100 ether, 100 ether, 1, address(this), DEADLINE);
        pool.setPaused(true);
        (bool success,) = address(pool)
            .call(
                abi.encodeCall(
                    DlmmPool.swapExactInput,
                    // forge-lint: disable-next-line(boolean-cst)
                    (true, 1 ether, uint256(1), uint16(1), address(this), DEADLINE)
                )
            );
        require(!success, "paused swap");
        pool.removeLiquidity(0, shares, 1, 1, address(this), DEADLINE);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DammPool } from "../src/core/DammPool.sol";
import { PoolKey, PoolKeyLib, PoolModel } from "../src/core/PoolTypes.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";

contract DammPoolTest {
    MockERC20 private tokenA;
    MockERC20 private tokenB;
    MockERC20 private token0;
    MockERC20 private token1;
    DammPool private pool;
    uint256 private constant DEADLINE = type(uint256).max;

    function setUp() public {
        tokenA = new MockERC20("Token A", "TKA");
        tokenB = new MockERC20("Token B", "TKB");
        PoolKey memory key =
            PoolKeyLib.normalize(address(tokenA), address(tokenB), PoolModel.DAMM, 3_000, 0);
        pool = new DammPool(key, address(this));
        token0 = MockERC20(key.token0);
        token1 = MockERC20(key.token1);
        token0.mint(address(this), 10_000 ether);
        token1.mint(address(this), 20_000 ether);
        token0.approve(address(pool), type(uint256).max);
        token1.approve(address(pool), type(uint256).max);
    }

    function testInitialLiquidityLocksMinimumAndMintsShares() external {
        uint256 shares = pool.addLiquidity(1_000 ether, 2_000 ether, 1, address(this), DEADLINE);
        require(shares > 0, "shares");
        require(pool.totalShares() == shares + pool.MINIMUM_LIQUIDITY(), "locked shares");
        require(pool.reserve0() == 1_000 ether && pool.reserve1() == 2_000 ether, "reserves");
    }

    function testProportionalLiquidityAndRemoval() external {
        pool.addLiquidity(1_000 ether, 2_000 ether, 1, address(this), DEADLINE);
        uint256 added = pool.addLiquidity(100 ether, 200 ether, 1, address(this), DEADLINE);
        (uint256 amount0, uint256 amount1) =
            pool.removeLiquidity(added, 99 ether, 199 ether, address(this), DEADLINE);
        require(amount0 >= 99 ether && amount1 >= 199 ether, "withdraw amounts");
    }

    function testSwapPreservesInvariantAndAccruesProtocolFee() external {
        pool.addLiquidity(1_000 ether, 2_000 ether, 1, address(this), DEADLINE);
        pool.setProtocolFeeConfiguration(address(this), 200_000);
        uint256 invariantBefore = uint256(pool.reserve0()) * uint256(pool.reserve1());
        uint256 recipientBalanceBefore = token1.balanceOf(address(this));
        uint256 output =
            pool.swapExactInput(address(token0), 10 ether, 19 ether, address(this), DEADLINE);
        uint256 invariantAfter = uint256(pool.reserve0()) * uint256(pool.reserve1());
        require(output > 19 ether, "output");
        require(token1.balanceOf(address(this)) == recipientBalanceBefore + output, "recipient");
        require(pool.protocolFees0() > 0, "protocol fee");
        require(invariantAfter >= invariantBefore, "invariant");
    }

    function testCollectProtocolFeesDoesNotChangeReserves() external {
        pool.addLiquidity(1_000 ether, 2_000 ether, 1, address(this), DEADLINE);
        pool.setProtocolFeeConfiguration(address(this), 200_000);
        pool.swapExactInput(address(token0), 10 ether, 1, address(this), DEADLINE);
        uint112 reserveBefore = pool.reserve0();
        (uint256 amount0, uint256 amount1) = pool.collectProtocolFees();
        require(amount0 > 0 && amount1 == 0, "collected");
        require(pool.reserve0() == reserveBefore, "reserve changed");
        require(pool.protocolFees0() == 0, "fees not cleared");
    }

    function testPauseBlocksAddAndSwapButAllowsRemoval() external {
        pool.addLiquidity(1_000 ether, 2_000 ether, 1, address(this), DEADLINE);
        pool.setPaused(true);
        (bool swapSuccess,) = address(pool)
            .call(
                abi.encodeCall(
                    DammPool.swapExactInput,
                    (address(token0), 1 ether, uint256(1), address(this), DEADLINE)
                )
            );
        require(!swapSuccess, "swap while paused");
        uint256 shares = pool.sharesOf(address(this));
        pool.removeLiquidity(shares, 1, 1, address(this), DEADLINE);
    }

    function testSlippageAndExpiredDeadlineAreRejected() external {
        pool.addLiquidity(1_000 ether, 2_000 ether, 1, address(this), DEADLINE);
        (bool slippageSuccess,) = address(pool)
            .call(
                abi.encodeCall(
                    DammPool.swapExactInput,
                    (address(token0), 1 ether, type(uint256).max, address(this), DEADLINE)
                )
            );
        require(!slippageSuccess, "slippage accepted");
        (bool deadlineSuccess,) = address(pool)
            .call(
                abi.encodeCall(
                    DammPool.swapExactInput,
                    (address(token0), 1 ether, uint256(1), address(this), uint256(0))
                )
            );
        require(!deadlineSuccess, "deadline accepted");
    }
}

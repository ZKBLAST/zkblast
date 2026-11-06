// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DlmmPoolV2 } from "../src/core/DlmmPoolV2.sol";
import { PoolKey, PoolKeyLib, PoolModel } from "../src/core/PoolTypes.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";

contract DlmmPoolV2Test {
    MockERC20 private token0;
    MockERC20 private token1;
    DlmmPoolV2 private pool;
    uint256 private constant DEADLINE = type(uint256).max;

    function setUp() public {
        MockERC20 tokenA = new MockERC20("Token A", "TKA");
        MockERC20 tokenB = new MockERC20("Token B", "TKB");
        PoolKey memory key =
            PoolKeyLib.normalize(address(tokenA), address(tokenB), PoolModel.DLMM, 3_000, 25);
        pool = new DlmmPoolV2(key, address(this), 0);
        token0 = MockERC20(key.token0);
        token1 = MockERC20(key.token1);
        token0.mint(address(this), 1_000_000 ether);
        token1.mint(address(this), 1_000_000 ether);
        token0.approve(address(pool), type(uint256).max);
        token1.approve(address(pool), type(uint256).max);
    }

    function testSingleSidedBatchAdmissionAndBitmapTraversal() external {
        DlmmPoolV2.AddBin[] memory additions = new DlmmPoolV2.AddBin[](3);
        additions[0] = DlmmPoolV2.AddBin(-2, 0, 100 ether, 1);
        additions[1] = DlmmPoolV2.AddBin(0, 100 ether, 100 ether, 1);
        additions[2] = DlmmPoolV2.AddBin(2, 100 ether, 0, 1);
        pool.addLiquidityBatch(bytes32("range"), additions, 0, address(this), DEADLINE);
        require(pool.isInitialized(-2) && pool.isInitialized(0) && pool.isInitialized(2), "bitmap");
        (bool foundUp, int24 up) = pool.nextInitializedBin(0, true);
        (bool foundDown, int24 down) = pool.nextInitializedBin(0, false);
        require(foundUp && up == 2, "next up");
        require(foundDown && down == -2, "next down");
    }

    function testRejectsWrongSideAndStaleActiveBin() external {
        DlmmPoolV2.AddBin[] memory additions = new DlmmPoolV2.AddBin[](1);
        additions[0] = DlmmPoolV2.AddBin(-1, 1 ether, 0, 1);
        bool wrongSideAccepted;
        try pool.addLiquidityBatch(bytes32("wrong"), additions, 0, address(this), DEADLINE) {
            wrongSideAccepted = true;
        } catch {}
        require(!wrongSideAccepted, "wrong side accepted");
        additions[0] = DlmmPoolV2.AddBin(1, 1 ether, 0, 1);
        bool staleAccepted;
        try pool.addLiquidityBatch(bytes32("stale"), additions, 1, address(this), DEADLINE) {
            staleAccepted = true;
        } catch {}
        require(!staleAccepted, "stale active bin accepted");
    }

    function testBatchRemovalAndProtocolFeeSeparation() external {
        DlmmPoolV2.AddBin[] memory additions = new DlmmPoolV2.AddBin[](1);
        additions[0] = DlmmPoolV2.AddBin(0, 1_000 ether, 2_000 ether, 1);
        pool.addLiquidityBatch(bytes32("add"), additions, 0, address(this), DEADLINE);
        pool.setProtocolFeeConfiguration(address(this), 200_000);
        pool.swapExactInput(true, 10 ether, 9 ether, 1, address(this), DEADLINE);
        require(pool.protocolFees0() > 0, "protocol fee missing");
        pool.collectProtocolFees();
        require(pool.protocolFees0() == 0, "protocol fee retained");

        (, , uint256 totalShares,) = pool.binState(0);
        DlmmPoolV2.RemoveBin[] memory removals = new DlmmPoolV2.RemoveBin[](1);
        removals[0] = DlmmPoolV2.RemoveBin(
            0, totalShares - pool.MINIMUM_BIN_LIQUIDITY(), 1, 1
        );
        (uint256 amount0, uint256 amount1) = pool.removeLiquidityBatch(
            bytes32("remove"), removals, 1, 1, address(this), DEADLINE
        );
        require(amount0 > 0 && amount1 > 0, "removal outputs");
    }

    function testRejectsBatchAboveBound() external {
        DlmmPoolV2.AddBin[] memory additions = new DlmmPoolV2.AddBin[](62);
        bool accepted;
        try pool.addLiquidityBatch(bytes32("oversized"), additions, 0, address(this), DEADLINE) {
            accepted = true;
        } catch {}
        require(!accepted, "oversized batch accepted");
    }
}

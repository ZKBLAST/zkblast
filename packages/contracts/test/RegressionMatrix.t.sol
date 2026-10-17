// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DammPool } from "../src/core/DammPool.sol";
import { DlmmPool } from "../src/core/DlmmPool.sol";
import { PoolKey, PoolKeyLib, PoolModel } from "../src/core/PoolTypes.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";
import { ReentrantERC20 } from "./mocks/ReentrantERC20.sol";

contract UnauthorizedPoolCaller {
    function pauseDamm(DammPool pool) external returns (bool success) {
        (success,) = address(pool).call(abi.encodeCall(DammPool.setPaused, (true)));
    }

    function pauseDlmm(DlmmPool pool) external returns (bool success) {
        (success,) = address(pool).call(abi.encodeCall(DlmmPool.setPaused, (true)));
    }
}

contract RegressionMatrixTest {
    uint256 private constant DEADLINE = type(uint256).max;

    function testDammRejectsTokenCallbackReentrancy() external {
        ReentrantERC20 malicious = new ReentrantERC20();
        MockERC20 regular = new MockERC20("Regular", "REG");
        PoolKey memory key =
            PoolKeyLib.normalize(address(malicious), address(regular), PoolModel.DAMM, 3_000, 0);
        DammPool pool = new DammPool(key, address(this));
        malicious.mint(address(this), 1_000 ether);
        regular.mint(address(this), 1_000 ether);
        malicious.approve(address(pool), type(uint256).max);
        regular.approve(address(pool), type(uint256).max);
        malicious.configureCallback(
            address(pool),
            abi.encodeCall(
                DammPool.addLiquidity, (uint256(1), uint256(1), uint256(1), address(this), DEADLINE)
            )
        );

        pool.addLiquidity(100 ether, 100 ether, 1, address(this), DEADLINE);
        require(malicious.callbackAttempted(), "callback not attempted");
        require(!malicious.callbackSucceeded(), "reentrancy succeeded");
    }

    function testUnauthorizedPoolAdministrationIsRejected() external {
        MockERC20 tokenA = new MockERC20("Token A", "TKA");
        MockERC20 tokenB = new MockERC20("Token B", "TKB");
        UnauthorizedPoolCaller caller = new UnauthorizedPoolCaller();
        PoolKey memory dammKey =
            PoolKeyLib.normalize(address(tokenA), address(tokenB), PoolModel.DAMM, 3_000, 0);
        PoolKey memory dlmmKey =
            PoolKeyLib.normalize(address(tokenA), address(tokenB), PoolModel.DLMM, 3_000, 25);
        DammPool damm = new DammPool(dammKey, address(this));
        DlmmPool dlmm = new DlmmPool(dlmmKey, address(this), 0);

        require(!caller.pauseDamm(damm), "DAMM unauthorized pause");
        require(!caller.pauseDlmm(dlmm), "DLMM unauthorized pause");
    }

    function testDlmmRejectsSlippageAndExpiredDeadline() external {
        MockERC20 tokenA = new MockERC20("Token A", "TKA");
        MockERC20 tokenB = new MockERC20("Token B", "TKB");
        PoolKey memory key =
            PoolKeyLib.normalize(address(tokenA), address(tokenB), PoolModel.DLMM, 3_000, 25);
        DlmmPool pool = new DlmmPool(key, address(this), 0);
        MockERC20 token0 = MockERC20(key.token0);
        MockERC20 token1 = MockERC20(key.token1);
        token0.mint(address(this), 1_000 ether);
        token1.mint(address(this), 1_000 ether);
        token0.approve(address(pool), type(uint256).max);
        token1.approve(address(pool), type(uint256).max);
        pool.addLiquidity(0, 100 ether, 100 ether, 1, address(this), DEADLINE);

        (bool slippageSuccess,) = address(pool)
            .call(
                abi.encodeCall(
                    DlmmPool.swapExactInput,
                    // forge-lint: disable-next-line(boolean-cst)
                    (true, 1 ether, 2 ether, uint16(1), address(this), DEADLINE)
                )
            );
        (bool deadlineSuccess,) = address(pool)
            .call(
                abi.encodeCall(
                    DlmmPool.swapExactInput,
                    // forge-lint: disable-next-line(boolean-cst)
                    (true, 1 ether, uint256(1), uint16(1), address(this), block.timestamp - 1)
                )
            );
        require(!slippageSuccess, "DLMM slippage accepted");
        require(!deadlineSuccess, "DLMM expired deadline accepted");
    }
}

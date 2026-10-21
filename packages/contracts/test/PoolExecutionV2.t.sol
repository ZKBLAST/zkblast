// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DammPool } from "../src/core/DammPool.sol";
import { DlmmPool } from "../src/core/DlmmPool.sol";
import { PoolRegistry } from "../src/core/PoolRegistry.sol";
import { PoolKey, PoolKeyLib, PoolModel } from "../src/core/PoolTypes.sol";
import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";
import { ConstantProductMath } from "../src/math/ConstantProductMath.sol";
import { PoolExecutionV2 } from "../src/privacy/v2/PoolExecutionV2.sol";
import { SettlementTermsV2 } from "../src/privacy/v2/SettlementTermsV2.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";

/// @dev Execution harness only. No note/proof authorization or real custody UI.
contract PoolExecutionHarness {
    function execute(
        PoolRegistry registry,
        SettlementTermsV2.Terms memory terms,
        uint128[3] memory inflows,
        uint128[3] memory outflows
    ) external {
        PoolExecutionV2.execute(registry, terms, 1, inflows, outflows);
    }
}

contract PoolExecutionV2Test {
    PoolRegistry private registry;
    PoolExecutionHarness private executor;
    MockERC20 private token0;
    MockERC20 private token1;
    DammPool private damm;
    DlmmPool private dlmm;
    uint128 private constant AMOUNT = 100 ether;

    function setUp() public {
        MockERC20 a = new MockERC20("A", "A");
        MockERC20 b = new MockERC20("B", "B");
        PoolKey memory key = PoolKeyLib.normalize(address(a), address(b), PoolModel.DAMM, 3000, 0);
        token0 = MockERC20(key.token0);
        token1 = MockERC20(key.token1);
        registry = PoolRegistry(
            address(
                new ERC1967Proxy(
                    address(new PoolRegistry()),
                    abi.encodeCall(
                        PoolRegistry.initialize, (address(this), address(this), address(this))
                    )
                )
            )
        );
        damm = new DammPool(key, address(this));
        registry.registerPool(PoolKeyLib.id(key), address(damm), key);
        key.model = PoolModel.DLMM;
        key.binStepBps = 10;
        dlmm = new DlmmPool(key, address(this), 0);
        registry.registerPool(PoolKeyLib.id(key), address(dlmm), key);
        executor = new PoolExecutionHarness();
        token0.mint(address(executor), 1000 ether);
        token1.mint(address(executor), 1000 ether);
    }

    function terms(bool discrete) private view returns (SettlementTermsV2.Terms memory t) {
        t.chainId = uint64(block.chainid);
        t.settlement = address(executor);
        t.action = 3;
        t.pool = discrete ? address(dlmm) : address(damm);
        t.model = discrete ? 1 : 0;
        t.asset0 = address(token0);
        t.asset1 = address(token1);
        t.amount0 = AMOUNT;
        t.amount1 = AMOUNT;
        t.minimumShares = 1;
        t.feeRecipient = address(this);
        t.deadline = uint64(block.timestamp + 100);
        t.refundCommitment = bytes32(uint256(1));
        t.outputCommitment0 = bytes32(uint256(2));
        t.outputCommitment1 = bytes32(uint256(3));
    }

    function lifecycle(bool discrete) private {
        SettlementTermsV2.Terms memory t = terms(discrete);
        uint128 shares = AMOUNT - 1000;
        executor.execute(registry, t, [uint128(0), 0, shares], [AMOUNT, AMOUNT, uint128(0)]);
        require(token0.allowance(address(executor), t.pool) == 0, "approval remains");
        uint128 input = 1 ether;
        uint128 output;
        if (discrete) {
            output = input - input * 3000 / 1_000_000;
        } else {
            (uint256 quoted,) = ConstantProductMath.quoteExactInput(input, AMOUNT, AMOUNT, 3000);
            output = uint128(quoted);
        }
        t.action = 2;
        t.amount0 = input;
        t.amount1 = 0;
        t.minimumShares = 0;
        t.minimum1 = output;
        executor.execute(registry, t, [uint128(0), output, uint128(0)], [input, uint128(0), 0]);
        require(token0.allowance(address(executor), t.pool) == 0, "swap approval remains");
        t.action = 4;
        t.amount0 = 0;
        t.shares = shares;
        t.minimum0 = 1;
        t.minimum1 = 1;
        uint256 reserve0;
        uint256 reserve1;
        uint256 supply;
        if (discrete) {
            (reserve0, reserve1, supply,) = dlmm.binState(0);
        } else {
            reserve0 = damm.reserve0();
            reserve1 = damm.reserve1();
            supply = damm.totalShares();
        }
        executor.execute(
            registry,
            t,
            [
                uint128(uint256(shares) * reserve0 / supply),
                uint128(uint256(shares) * reserve1 / supply),
                uint128(0)
            ],
            [uint128(0), 0, shares]
        );
        uint256 left =
            discrete ? dlmm.sharesOf(0, address(executor)) : damm.sharesOf(address(executor));
        require(left == 0, "position not closed");
    }

    function testDammActualPoolAddSwapRemove() public {
        lifecycle(false);
    }

    function testDlmmActualPoolAddSwapRemove() public {
        lifecycle(true);
    }

    function testMismatchedProofDeltaRevertsAllPoolAndTokenChanges() public {
        SettlementTermsV2.Terms memory t = terms(false);
        uint256 balance = token0.balanceOf(address(executor));
        (bool ok,) = address(executor)
            .call(
                abi.encodeCall(
                    executor.execute,
                    (registry, t, [uint128(0), 0, AMOUNT - 999], [AMOUNT, AMOUNT, uint128(0)])
                )
            );
        require(!ok, "wrong delta accepted");
        require(damm.totalShares() == 0 && damm.reserve0() == 0, "pool partially changed");
        require(token0.balanceOf(address(executor)) == balance, "tokens moved");
        require(token0.allowance(address(executor), address(damm)) == 0, "approval retained");
    }

    function testWrongChainAndPoolModelReject() public {
        SettlementTermsV2.Terms memory t = terms(false);
        t.chainId++;
        (bool ok,) = address(executor)
            .call(
                abi.encodeCall(
                    executor.execute,
                    (registry, t, [uint128(0), 0, AMOUNT - 1000], [AMOUNT, AMOUNT, uint128(0)])
                )
            );
        require(!ok, "wrong network accepted");
        t = terms(false);
        t.model = 1;
        (ok,) = address(executor)
            .call(
                abi.encodeCall(
                    executor.execute,
                    (registry, t, [uint128(0), 0, AMOUNT - 1000], [AMOUNT, AMOUNT, uint128(0)])
                )
            );
        require(!ok, "wrong pool model accepted");
    }
}

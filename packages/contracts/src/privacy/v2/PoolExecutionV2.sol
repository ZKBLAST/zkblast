// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DammPool } from "../../core/DammPool.sol";
import { DlmmPool } from "../../core/DlmmPool.sol";
import { PoolRegistry } from "../../core/PoolRegistry.sol";
import { PoolKey, PoolKeyLib, PoolModel } from "../../core/PoolTypes.sol";
import { IERC20Minimal } from "../../interfaces/IERC20Minimal.sol";
import { TokenTransfer } from "../../libraries/TokenTransfer.sol";
import { SettlementTermsV2 } from "./SettlementTermsV2.sol";

/// @notice Internal pool adapter; no public entrypoint or separate asset custody.
/// @dev The calling v2 settlement must authenticate the proof, reserve/spend state
/// and fees. Exact expected deltas must come from the verified public statement.
library PoolExecutionV2 {
    using TokenTransfer for address;

    error InvalidExecutionContext();
    error UnregisteredPool();
    error PoolIdentityMismatch();
    error ActualDeltaMismatch();

    function execute(
        PoolRegistry registry,
        SettlementTermsV2.Terms memory t,
        uint16 maximumBinCrossings,
        uint128[3] memory expectedInflows,
        uint128[3] memory expectedOutflows
    ) internal {
        SettlementTermsV2.validate(t);
        if (t.chainId != block.chainid || t.settlement != address(this)) {
            revert InvalidExecutionContext();
        }
        if (!registry.isRegisteredPool(t.pool)) revert UnregisteredPool();
        PoolKey memory key = PoolKey(
            t.asset0,
            t.asset1,
            PoolModel(t.model),
            DammPool(t.pool).feePips(),
            t.model == 0 ? 0 : DlmmPool(t.pool).binStepBps()
        );
        if (
            registry.idByPool(t.pool) != PoolKeyLib.id(key) || DammPool(t.pool).token0() != t.asset0
                || DammPool(t.pool).token1() != t.asset1
        ) revert PoolIdentityMismatch();

        uint256[3] memory beforeBalances = _balances(t);
        _perform(t, maximumBinCrossings);
        uint256[3] memory afterBalances = _balances(t);
        for (uint256 i; i < 3; ++i) {
            if (expectedInflows[i] != 0 && expectedOutflows[i] != 0) {
                revert ActualDeltaMismatch();
            }
            if (beforeBalances[i] + expectedInflows[i] != afterBalances[i] + expectedOutflows[i]) {
                revert ActualDeltaMismatch();
            }
        }
    }

    function _perform(SettlementTermsV2.Terms memory t, uint16 maximumBinCrossings) private {
        if (t.action == 2) {
            bool zeroForOne = t.amount0 != 0;
            address tokenIn = zeroForOne ? t.asset0 : t.asset1;
            uint256 amount = zeroForOne ? t.amount0 : t.amount1;
            uint256 minimum = zeroForOne ? t.minimum1 : t.minimum0;
            tokenIn.forceApprove(t.pool, amount);
            if (t.model == 0) {
                DammPool(t.pool).swapExactInput(tokenIn, amount, minimum, address(this), t.deadline);
            } else {
                DlmmPool(t.pool)
                    .swapExactInput(
                        zeroForOne, amount, minimum, maximumBinCrossings, address(this), t.deadline
                    );
            }
            tokenIn.forceApprove(t.pool, 0);
        } else if (t.action == 3) {
            // Current DAMM and DLMM implementations both require two-sided adds.
            if (t.amount0 == 0 || t.amount1 == 0) revert InvalidExecutionContext();
            t.asset0.forceApprove(t.pool, t.amount0);
            t.asset1.forceApprove(t.pool, t.amount1);
            if (t.model == 0) {
                DammPool(t.pool)
                    .addLiquidity(t.amount0, t.amount1, t.minimumShares, address(this), t.deadline);
            } else {
                DlmmPool(t.pool)
                    .addLiquidity(
                        t.binId, t.amount0, t.amount1, t.minimumShares, address(this), t.deadline
                    );
            }
            t.asset0.forceApprove(t.pool, 0);
            t.asset1.forceApprove(t.pool, 0);
        } else {
            if (t.model == 0) {
                DammPool(t.pool)
                    .removeLiquidity(t.shares, t.minimum0, t.minimum1, address(this), t.deadline);
            } else {
                DlmmPool(t.pool)
                    .removeLiquidity(
                        t.binId, t.shares, t.minimum0, t.minimum1, address(this), t.deadline
                    );
            }
        }
    }

    function _balances(SettlementTermsV2.Terms memory t)
        private
        view
        returns (uint256[3] memory values)
    {
        values[0] = IERC20Minimal(t.asset0).balanceOf(address(this));
        values[1] = IERC20Minimal(t.asset1).balanceOf(address(this));
        values[2] = t.model == 0
            ? DammPool(t.pool).sharesOf(address(this))
            : DlmmPool(t.pool).sharesOf(t.binId, address(this));
    }
}

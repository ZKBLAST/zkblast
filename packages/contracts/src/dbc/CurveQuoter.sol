// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DbcTypes } from "./DbcTypes.sol";
import { VirtualPool } from "./VirtualPool.sol";

/// @notice Stateless read surface for SDK, API, and web clients.
contract CurveQuoter {
    struct PoolState {
        DbcTypes.Lifecycle lifecycle;
        uint256 baseSoldRaw;
        uint256 realQuoteReserveRaw;
        uint256 totalFeeLiabilityRaw;
        uint256 graduationProgressBps;
    }

    function quoteBuy(VirtualPool pool, uint256 grossQuoteInRaw)
        external
        view
        returns (VirtualPool.BuyQuote memory)
    {
        return pool.quoteBuyExactInput(grossQuoteInRaw);
    }

    function quoteSell(VirtualPool pool, uint256 baseInRaw)
        external
        view
        returns (VirtualPool.SellQuote memory)
    {
        return pool.quoteSellExactInput(baseInRaw);
    }

    function quoteBuyExactOutput(VirtualPool pool, uint256 baseOutRaw)
        external
        view
        returns (VirtualPool.BuyQuote memory)
    {
        return pool.quoteBuyExactOutput(baseOutRaw);
    }

    function quoteSellExactOutput(VirtualPool pool, uint256 quoteOutRaw)
        external
        view
        returns (VirtualPool.SellQuote memory)
    {
        return pool.quoteSellExactOutput(quoteOutRaw);
    }

    function poolState(VirtualPool pool) external view returns (PoolState memory state) {
        (
            uint128 baseSold,
            uint128 reserve,
            uint128 creatorFees,
            uint128 partnerFees,
            uint128 protocolFees,,
            uint128 quoteDust
        ) = pool.accounting();
        state = PoolState({
            lifecycle: pool.lifecycle(),
            baseSoldRaw: baseSold,
            realQuoteReserveRaw: reserve,
            totalFeeLiabilityRaw: uint256(creatorFees) + partnerFees + protocolFees + quoteDust,
            graduationProgressBps: pool.graduationProgressBps()
        });
    }
}

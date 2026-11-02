// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DbcTypes } from "./DbcTypes.sol";
import { VirtualPool } from "./VirtualPool.sol";
import { LaunchpadFeeController } from "../launchpad/LaunchpadFeeController.sol";
import { LaunchpadTokenFactory } from "../launchpad/LaunchpadTokenFactory.sol";

/// @notice Stateless read surface for SDK, API, and web clients.
contract CurveQuoter {
    uint256 private constant BPS = 10_000;
    struct PoolState {
        DbcTypes.Lifecycle lifecycle;
        uint256 baseSoldRaw;
        uint256 realQuoteReserveRaw;
        uint256 totalFeeLiabilityRaw;
        uint256 graduationProgressBps;
    }

    struct LaunchpadQuote {
        bytes32 launchId;
        uint256 launchpadId;
        bytes32 feeSnapshotId;
        address pool;
        bool isBuy;
        uint256 amountInRaw;
        uint256 amountOutRaw;
        uint256 feeRaw;
        uint256 finalPriceX18;
        uint256 protocolFeeRaw;
        uint256 operatorFeeRaw;
        uint256 creatorFeeRaw;
        uint256 referralFeeRaw;
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

    function quoteLaunchpad(
        LaunchpadTokenFactory tokenFactory,
        LaunchpadFeeController feeController,
        bytes32 launchId,
        bool isBuy,
        uint256 amountInRaw
    ) external view returns (LaunchpadQuote memory result) {
        LaunchpadTokenFactory.LaunchBinding memory binding = tokenFactory.binding(launchId);
        LaunchpadFeeController.FeeSnapshot memory fees =
            feeController.snapshot(binding.feeSnapshotId);
        VirtualPool pool = VirtualPool(binding.virtualPool);
        uint256 feeRaw;
        uint256 amountOutRaw;
        uint256 finalPriceX18;
        if (isBuy) {
            VirtualPool.BuyQuote memory quote = pool.quoteBuyExactInput(amountInRaw);
            feeRaw = quote.feeRaw;
            amountOutRaw = quote.baseOutRaw;
            finalPriceX18 = quote.finalPriceX18;
            amountInRaw = quote.grossQuoteConsumedRaw;
        } else {
            VirtualPool.SellQuote memory quote = pool.quoteSellExactInput(amountInRaw);
            feeRaw = quote.feeRaw;
            amountOutRaw = quote.netQuoteOutRaw;
            finalPriceX18 = quote.finalPriceX18;
        }
        uint256 operatorFee = feeRaw * fees.shares.operatorShareBps / BPS;
        uint256 creatorFee = feeRaw * fees.shares.creatorShareBps / BPS;
        uint256 referralFee = feeRaw * fees.shares.referralShareBps / BPS;
        result = LaunchpadQuote({
            launchId: launchId,
            launchpadId: binding.launchpadId,
            feeSnapshotId: binding.feeSnapshotId,
            pool: binding.virtualPool,
            isBuy: isBuy,
            amountInRaw: amountInRaw,
            amountOutRaw: amountOutRaw,
            feeRaw: feeRaw,
            finalPriceX18: finalPriceX18,
            protocolFeeRaw: feeRaw - operatorFee - creatorFee - referralFee,
            operatorFeeRaw: operatorFee,
            creatorFeeRaw: creatorFee,
            referralFeeRaw: referralFee
        });
    }
}

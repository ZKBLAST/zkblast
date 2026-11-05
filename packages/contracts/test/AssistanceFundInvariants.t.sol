// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AssistanceFundTypes} from "../src/revenue/AssistanceFundTypes.sol";

/// @notice Deterministic accounting properties independent of token decimals or asset identity.
contract AssistanceFundInvariantsTest {
    function testFuzzAllocationAlwaysConservesEligibleRevenue(uint256 eligibleAmount) external pure {
        AssistanceFundTypes.Allocation memory allocation = AssistanceFundTypes.allocate(eligibleAmount);

        require(allocation.buybackAmount + allocation.treasuryAmount == eligibleAmount, "allocation conservation");
        require(allocation.buybackAmount <= eligibleAmount, "buyback overflow");
        uint256 expectedTreasury = eligibleAmount / 100 + (eligibleAmount % 100 == 0 ? 0 : 1);
        require(allocation.treasuryAmount == expectedTreasury, "treasury rounding");
    }

    function testFuzzRepeatedRevenueRemainsConserved(uint64 amountSeed, uint8 repeatSeed) external pure {
        uint256 amount = uint256(amountSeed) + 1;
        uint256 repeats = uint256(repeatSeed % 16) + 1;
        AssistanceFundTypes.AssetLedger memory ledger;

        for (uint256 index = 0; index < repeats; index++) {
            AssistanceFundTypes.Allocation memory allocation = AssistanceFundTypes.allocate(amount);
            ledger.collected += amount;
            ledger.allocatedBuyback += allocation.buybackAmount;
            ledger.allocatedTreasury += allocation.treasuryAmount;
        }

        require(ledger.collected == amount * repeats, "collected total");
        require(AssistanceFundTypes.isConserved(ledger), "ledger conservation");
        require(
            AssistanceFundTypes.pendingBuyback(ledger) + AssistanceFundTypes.treasuryClaimable(ledger)
                == ledger.collected,
            "liability conservation"
        );
    }

    function testFuzzMultipleAssetLedgersStayIndependent(uint96 firstAmount, uint96 secondAmount) external pure {
        AssistanceFundTypes.AssetLedger memory first = _ledger(uint256(firstAmount) + 1);
        AssistanceFundTypes.AssetLedger memory second = _ledger(uint256(secondAmount) + 1);

        require(AssistanceFundTypes.isConserved(first), "first asset");
        require(AssistanceFundTypes.isConserved(second), "second asset");
        require(first.collected == uint256(firstAmount) + 1, "first units");
        require(second.collected == uint256(secondAmount) + 1, "second units");
    }

    function testFuzzSpendAndClaimRemainInsideIndependentAllocations(uint96 eligibleSeed) external pure {
        AssistanceFundTypes.AssetLedger memory ledger = _ledger(uint256(eligibleSeed) + 1);
        ledger.spentBuyback = ledger.allocatedBuyback;
        ledger.claimedTreasury = ledger.allocatedTreasury;

        require(AssistanceFundTypes.isConserved(ledger), "settled ledger");
        require(AssistanceFundTypes.pendingBuyback(ledger) == 0, "buyback remainder");
        require(AssistanceFundTypes.treasuryClaimable(ledger) == 0, "treasury remainder");
    }

    function _ledger(uint256 eligibleAmount)
        private
        pure
        returns (AssistanceFundTypes.AssetLedger memory ledger)
    {
        AssistanceFundTypes.Allocation memory allocation = AssistanceFundTypes.allocate(eligibleAmount);
        ledger.collected = eligibleAmount;
        ledger.allocatedBuyback = allocation.buybackAmount;
        ledger.allocatedTreasury = allocation.treasuryAmount;
    }

}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { BondingCurveMath } from "../src/dbc/BondingCurveMath.sol";
import { DbcTypes } from "../src/dbc/DbcTypes.sol";
import { SegmentedBondingCurveMath } from "../src/dbc/SegmentedBondingCurveMath.sol";

contract DbcFoundationTest {
    function testLinearCurveKnownVectors() external pure {
        DbcTypes.LinearSegment memory curve = _curve();

        require(BondingCurveMath.marginalPrice(curve, 0) == 1e18, "initial price");
        require(BondingCurveMath.quoteBuyExactBase(curve, 0, 1e18) == 1.05e18, "first buy integral");
        require(
            BondingCurveMath.quoteBuyExactBase(curve, 2e18, 1e18) == 1.25e18, "later buy integral"
        );
        require(BondingCurveMath.quoteSellExactBase(curve, 1e18, 1e18) == 1.05e18, "sell integral");
    }

    function testInverseQuoteMatchesExactBaseVector() external pure {
        DbcTypes.LinearSegment memory curve = _curve();
        uint256 baseOut = BondingCurveMath.baseOutForNetQuote(curve, 0, 1.05e18);
        require(baseOut == 1e18, "inverse quote");
        require(
            BondingCurveMath.quoteBuyExactBase(curve, 0, baseOut) <= 1.05e18,
            "inverse exceeds input"
        );
    }

    function testFlatCurveAndCapacityBound() external pure {
        DbcTypes.LinearSegment memory curve =
            DbcTypes.LinearSegment({ initialPriceX18: 2e18, slopeX18: 0, saleCapacityX18: 10e18 });
        require(BondingCurveMath.baseOutForNetQuote(curve, 0, 4e18) == 2e18, "flat inverse");
        require(BondingCurveMath.baseOutForNetQuote(curve, 9e18, 4e18) == 1e18, "capacity clamp");
    }

    function testDecimalNormalizationRoundsAgainstTrader() external pure {
        require(BondingCurveMath.normalizeToX18(1_000_001, 6) == 1_000_001e12, "normalize");
        require(BondingCurveMath.denormalizeDown(1e18 + 1, 6) == 1_000_000, "down");
        require(BondingCurveMath.denormalizeUp(1e18 + 1, 6) == 1_000_001, "up");
    }

    function testFeesReconcileExactly() external pure {
        DbcTypes.FeePolicy memory policy = DbcTypes.FeePolicy({
            tradeFeeBps: 100,
            creatorShareBps: 4_000,
            partnerShareBps: 2_000,
            protocolShareBps: 4_000
        });
        uint256 fee = BondingCurveMath.feeOnGross(10_101, policy.tradeFeeBps);
        BondingCurveMath.FeeSplit memory split = BondingCurveMath.splitFee(fee, policy);
        require(fee == 101, "fee");
        require(split.creator == 40, "creator");
        require(split.partner == 20, "partner");
        require(split.protocol == 41, "protocol remainder");
        require(split.creator + split.partner + split.protocol == fee, "reconciliation");
    }

    function testBuySellRoundTripPreservesReserveCoverage() external pure {
        DbcTypes.LinearSegment memory curve = _curve();
        uint256 buyQuote = BondingCurveMath.quoteBuyExactBase(curve, 0, 3e18);
        uint256 sellQuote = BondingCurveMath.quoteSellExactBase(curve, 3e18, 3e18);
        require(buyQuote >= sellQuote, "reserve deficit");
        require(buyQuote - sellQuote <= 1, "unexpected rounding gap");
    }

    function testBoundaryVectorsAndInvalidInputs() external {
        DbcTypes.LinearSegment memory curve = _curve();
        require(
            BondingCurveMath.quoteBuyExactBase(curve, 99e18, 1e18) == 10.95e18, "terminal vector"
        );
        require(BondingCurveMath.quoteBuyExactBase(curve, 0, 1) == 1, "dust vector");

        (bool capacitySuccess,) =
            address(this).call(abi.encodeCall(this.quoteBuy, (curve, 99e18, 1e18 + 1)));
        require(!capacitySuccess, "capacity overflow accepted");

        (bool decimalsSuccess,) = address(this).call(abi.encodeCall(this.normalize, (1, 19)));
        require(!decimalsSuccess, "unsupported decimals accepted");
    }

    function testFuzzLinearCurveIsMonotonicAndCovered(uint96 soldSeed, uint96 amountSeed)
        external
        pure
    {
        DbcTypes.LinearSegment memory curve = _curve();
        uint256 sold = uint256(soldSeed) % 99e18;
        uint256 remaining = uint256(curve.saleCapacityX18) - sold;
        uint256 amount = (uint256(amountSeed) % remaining) + 1;

        uint256 startPrice = BondingCurveMath.marginalPrice(curve, sold);
        uint256 endPrice = BondingCurveMath.marginalPrice(curve, sold + amount);
        require(endPrice >= startPrice, "non-monotonic price");

        uint256 paid = BondingCurveMath.quoteBuyExactBase(curve, sold, amount);
        uint256 redeemable = BondingCurveMath.quoteSellExactBase(curve, sold + amount, amount);
        require(paid >= redeemable, "reserve coverage");
        require(paid - redeemable <= 1, "rounding tolerance");
    }

    function testFuzzInverseNeverOverspends(uint96 soldSeed, uint96 quoteSeed) external pure {
        DbcTypes.LinearSegment memory curve = _curve();
        uint256 sold = uint256(soldSeed) % 99e18;
        uint256 quote = (uint256(quoteSeed) % 100e18) + 1;
        uint256 baseOut = BondingCurveMath.baseOutForNetQuote(curve, sold, quote);
        if (baseOut == 0) return;
        require(
            BondingCurveMath.quoteBuyExactBase(curve, sold, baseOut) <= quote, "inverse overspend"
        );
        require(baseOut <= uint256(curve.saleCapacityX18) - sold, "inverse capacity");
    }

    function testSegmentedCurveCrossesContinuousBoundary() external pure {
        DbcTypes.CurveConfig memory curve = _segmentedCurve();
        require(SegmentedBondingCurveMath.validate(curve) == 10e18, "capacity");
        require(SegmentedBondingCurveMath.marginalPrice(curve, 5e18) == 1.5e18, "boundary price");
        require(
            SegmentedBondingCurveMath.quoteBuyExactBase(curve, 4e18, 2e18) == 3.05e18,
            "cross-boundary quote"
        );
        require(
            SegmentedBondingCurveMath.quoteSellExactBase(curve, 6e18, 2e18) == 3.05e18,
            "cross-boundary sell"
        );
        require(
            SegmentedBondingCurveMath.baseOutForNetQuote(curve, 4e18, 3.05e18) == 2e18,
            "cross-boundary inverse"
        );
    }

    function testSegmentedCurveRejectsDiscontinuity() external {
        DbcTypes.CurveConfig memory curve = _segmentedCurve();
        curve.segments[1].initialPriceX18 += 1;
        (bool success,) = address(this).call(abi.encodeCall(this.validateCurve, (curve)));
        require(!success, "discontinuous curve accepted");
    }

    function testReverseInverseMatchesSellAcrossBoundary() external pure {
        DbcTypes.CurveConfig memory curve = _segmentedCurve();
        uint256 baseIn = SegmentedBondingCurveMath.baseInForGrossQuote(curve, 6e18, 3.05e18);
        require(baseIn == 2e18, "reverse inverse");
        require(
            SegmentedBondingCurveMath.quoteSellExactBase(curve, 6e18, baseIn) >= 3.05e18,
            "reverse quote shortfall"
        );
    }

    function testFuzzReverseInverseNeverUnderpays(uint96 soldSeed, uint96 quoteSeed) external pure {
        DbcTypes.LinearSegment memory curve = _curve();
        uint256 sold = (uint256(soldSeed) % 100e18) + 1;
        uint256 maximum = BondingCurveMath.quoteSellExactBase(curve, sold, sold);
        uint256 target = (uint256(quoteSeed) % maximum) + 1;
        uint256 baseIn = BondingCurveMath.baseInForGrossQuote(curve, sold, target);
        require(baseIn <= sold, "reverse inventory");
        require(
            BondingCurveMath.quoteSellExactBase(curve, sold, baseIn) >= target,
            "reverse underpayment"
        );
    }

    function quoteBuy(DbcTypes.LinearSegment calldata curve, uint256 sold, uint256 amount)
        external
        pure
        returns (uint256)
    {
        return BondingCurveMath.quoteBuyExactBase(curve, sold, amount);
    }

    function normalize(uint256 amount, uint8 decimals) external pure returns (uint256) {
        return BondingCurveMath.normalizeToX18(amount, decimals);
    }

    function validateCurve(DbcTypes.CurveConfig calldata curve) external pure returns (uint256) {
        return SegmentedBondingCurveMath.validate(curve);
    }

    function _curve() private pure returns (DbcTypes.LinearSegment memory) {
        return DbcTypes.LinearSegment({
            initialPriceX18: 1e18, slopeX18: 0.1e18, saleCapacityX18: 100e18
        });
    }

    function _segmentedCurve() private pure returns (DbcTypes.CurveConfig memory curve) {
        curve.segmentCount = 2;
        curve.segments[0] = DbcTypes.LinearSegment({
            initialPriceX18: 1e18, slopeX18: 0.1e18, saleCapacityX18: 5e18
        });
        curve.segments[1] = DbcTypes.LinearSegment({
            initialPriceX18: 1.5e18, slopeX18: 0.2e18, saleCapacityX18: 5e18
        });
    }
}

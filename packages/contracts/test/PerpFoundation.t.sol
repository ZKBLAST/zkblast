// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ChainlinkOracleAdapter } from "../src/perps/ChainlinkOracleAdapter.sol";
import { PerpMarketRegistry } from "../src/perps/PerpMarketRegistry.sol";
import { PerpEngine } from "../src/perps/PerpEngine.sol";
import { PerpTypes } from "../src/perps/PerpTypes.sol";
import { PerpMath } from "../src/perps/PerpMath.sol";
import { InsuranceFund } from "../src/perps/InsuranceFund.sol";
import { LiquidityVaultUSDG } from "../src/perps/LiquidityVaultUSDG.sol";
import { FundingRateModule } from "../src/perps/FundingRateModule.sol";
import { IPerpOracle } from "../src/perps/interfaces/IPerpOracle.sol";
import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";

interface Vm {
    function warp(uint256 timestamp) external;
}

contract MockAggregatorV3 {
    uint8 public immutable decimals;
    int256 public answer;
    uint256 public updatedAt;
    uint80 public roundId = 1;
    uint80 public answeredInRound = 1;

    constructor(uint8 decimals_, int256 answer_, uint256 updatedAt_) {
        decimals = decimals_;
        answer = answer_;
        updatedAt = updatedAt_;
    }

    function description() external pure returns (string memory) {
        return "ETH / USD";
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, updatedAt, updatedAt, answeredInRound);
    }

    function setRound(int256 answer_, uint256 updatedAt_, uint80 answeredInRound_) external {
        answer = answer_;
        updatedAt = updatedAt_;
        answeredInRound = answeredInRound_;
    }
}

contract PerpFoundationTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    bytes32 private constant WETH_PERP = keccak256("WETH-PERP");
    bytes32 private constant ETH_USD = keccak256("ETH/USD");

    ChainlinkOracleAdapter private oracle;
    PerpMarketRegistry private registry;
    PerpEngine private engine;
    FundingRateModule private funding;
    MockAggregatorV3 private feed;

    function setUp() public {
        vm.warp(1_800_000_000);
        feed = new MockAggregatorV3(8, 2500e8, block.timestamp);

        ChainlinkOracleAdapter oracleImplementation = new ChainlinkOracleAdapter();
        oracle = ChainlinkOracleAdapter(
            address(
                new ERC1967Proxy(
                    address(oracleImplementation),
                    abi.encodeCall(
                        ChainlinkOracleAdapter.initialize,
                        (address(this), address(this), address(this))
                    )
                )
            )
        );
        oracle.configureFeed(ETH_USD, address(feed), 1 hours, true);

        PerpMarketRegistry registryImplementation = new PerpMarketRegistry();
        registry = PerpMarketRegistry(
            address(
                new ERC1967Proxy(
                    address(registryImplementation),
                    abi.encodeCall(
                        PerpMarketRegistry.initialize, (address(this), address(this), address(this))
                    )
                )
            )
        );

        FundingRateModule fundingImplementation = new FundingRateModule();
        funding = FundingRateModule(
            address(
                new ERC1967Proxy(
                    address(fundingImplementation),
                    abi.encodeCall(
                        FundingRateModule.initialize, (address(this), address(this), address(this))
                    )
                )
            )
        );
        funding.configureMarket(WETH_PERP, 100);

        PerpEngine engineImplementation = new PerpEngine();
        engine = PerpEngine(
            address(
                new ERC1967Proxy(
                    address(engineImplementation),
                    abi.encodeCall(
                        PerpEngine.initialize,
                        (
                            address(this),
                            address(this),
                            address(this),
                            address(this),
                            address(registry),
                            address(oracle),
                            address(funding)
                        )
                    )
                )
            )
        );
    }

    function testNormalizesOraclePriceAndRejectsStaleRound() external {
        IPerpOracle.Price memory price = oracle.latestPrice(ETH_USD);
        require(price.value == 2500e18, "price normalization");
        require(price.updatedAt == block.timestamp, "timestamp");

        feed.setRound(2500e8, block.timestamp - 1 hours - 1, 1);
        (bool success,) =
            address(oracle).call(abi.encodeCall(ChainlinkOracleAdapter.latestPrice, (ETH_USD)));
        require(!success, "stale price accepted");
    }

    function testRegistersCappedWethMarket() external {
        PerpTypes.MarketConfig memory config = _marketConfig();
        registry.registerMarket(WETH_PERP, config);

        PerpTypes.MarketConfig memory stored = registry.market(WETH_PERP);
        require(stored.maxOpenInterestUsd == 1e6, "OI cap");
        require(stored.maxPositionUsd == 250_000, "position cap");
        require(stored.maxLeverageBps == 20_000, "leverage cap");
        require(stored.enabled, "market disabled");
    }

    function testRejectsPositionCapAboveMarketCap() external {
        PerpTypes.MarketConfig memory config = PerpTypes.MarketConfig({
            baseAsset: address(0xBEEF),
            oracleId: ETH_USD,
            maxOpenInterestUsd: 1e6,
            maxSkewUsd: 500_000,
            maxPositionUsd: 2e6,
            minPositionUsd: 10_000,
            maxLeverageBps: 20_000,
            maintenanceMarginBps: 2_000,
            positionFeeBps: 10,
            liquidationFeeBps: 200,
            maxPriceImpactBps: 100,
            enabled: false
        });
        (bool success,) = address(registry)
            .call(abi.encodeCall(PerpMarketRegistry.registerMarket, (WETH_PERP, config)));
        require(!success, "invalid caps accepted");
    }

    function testPerpMathLongShortAndLiquidationBoundaries() external pure {
        uint256 margin = 100_000;
        uint256 positionNotional = PerpMath.notional(margin, 20_000);
        require(positionNotional == 200_000, "notional");
        require(PerpMath.requiredMargin(positionNotional, 20_000) == margin, "margin");
        require(PerpMath.fee(positionNotional, 10) == 200, "fee");

        uint256 size = PerpMath.baseSize(positionNotional, 2_000e18);
        require(size == 1e14, "base size");
        int256 longPnl = PerpMath.pnl(true, size, 2_000e18, 2_200e18);
        int256 shortPnl = PerpMath.pnl(false, size, 2_000e18, 2_200e18);
        require(longPnl == 20_000, "long pnl");
        require(shortPnl == -20_000, "short pnl");

        uint256 maintenance = PerpMath.maintenanceMargin(positionNotional, 2_000);
        require(maintenance == 40_000, "maintenance");
        require(!PerpMath.isLiquidatable(margin, -59_999, 0, maintenance), "early liquidation");
        require(PerpMath.isLiquidatable(margin, -60_000, 0, maintenance), "boundary");

        int256 postTradeSkew = PerpMath.skew(750_000, 250_000);
        require(postTradeSkew == 500_000, "skew");
        require(PerpMath.utilizationBps(500_000, 5e6) == 1_000, "utilization");
        uint256 impact = PerpMath.priceImpactBps(postTradeSkew, 1e6, 100);
        require(impact == 50, "impact");
        require(PerpMath.executionPrice(2_000e18, true, impact) == 2_010e18, "long price");
        require(PerpMath.executionPrice(2_000e18, false, impact) == 1_990e18, "short price");
        require(PerpMath.fundingPayment(1e6, 10, 1 hours) == 1_000, "funding");
    }

    function testEngineOpensAndClosesCappedLong() external {
        registry.registerMarket(WETH_PERP, _marketConfig());
        bytes32 positionId = keccak256("position-1");
        PerpEngine.OpenResult memory opened = engine.openPosition(
            PerpEngine.OpenRequest({
                positionId: positionId,
                ownerCommitment: keccak256("owner-1"),
                marketId: WETH_PERP,
                marginUsd: 100_000,
                leverageBps: 20_000,
                acceptablePriceX18: 2_510e18,
                deadline: uint64(block.timestamp + 1 hours),
                isLong: true
            })
        );
        require(opened.notionalUsd == 200_000, "open notional");
        require(opened.positionFeeUsd == 200, "open fee");
        require(opened.lockedMarginUsd == 99_800, "locked margin");
        PerpEngine.MarketRisk memory openRisk = engine.marketRisk(WETH_PERP);
        require(openRisk.longOpenInterestUsd == 200_000, "open OI");

        funding.setRate(WETH_PERP, 10);
        vm.warp(block.timestamp + 1 hours);
        feed.setRound(2750e8, block.timestamp, 1);
        PerpEngine.CloseResult memory closed = engine.closePosition(
            positionId, keccak256("payout-1"), 2_700e18, uint64(block.timestamp + 1 hours)
        );
        require(closed.realizedPnlUsd > 0, "profit");
        require(closed.fundingPaymentUsd == 200, "funding settlement");
        require(closed.payoutUsd > opened.lockedMarginUsd, "payout");
        PerpEngine.MarketRisk memory closedRisk = engine.marketRisk(WETH_PERP);
        require(closedRisk.longOpenInterestUsd == 0, "close OI");
        require(engine.getPosition(positionId).openedAt == 0, "position remains");
    }

    function testEngineModifyRealizesAccountingAndRotatesPositionKey() external {
        registry.registerMarket(WETH_PERP, _marketConfig());
        bytes32 oldPositionId = keccak256("position-modify-old");
        bytes32 newPositionId = keccak256("position-modify-new");
        engine.openPosition(
            PerpEngine.OpenRequest({
                positionId: oldPositionId,
                ownerCommitment: oldPositionId,
                marketId: WETH_PERP,
                marginUsd: 100_000,
                leverageBps: 20_000,
                acceptablePriceX18: 2_510e18,
                deadline: uint64(block.timestamp + 1 hours),
                isLong: true
            })
        );
        PerpEngine.Position memory oldPosition = engine.getPosition(oldPositionId);
        uint256 closePrice = 2_500e18;
        int256 pnl = PerpMath.pnl(
            true, oldPosition.baseSize, oldPosition.entryPriceX18, closePrice
        );
        uint256 closeNotional = PerpMath.notionalFromBase(oldPosition.baseSize, closePrice);
        uint256 closeFee = PerpMath.fee(closeNotional, 10);
        uint256 externalFee = 8;
        uint256 reopenMargin = uint256(int256(uint256(oldPosition.marginUsd)) + pnl)
            - closeFee - externalFee;
        uint256 reopenNotional = PerpMath.notional(reopenMargin, 10_000);
        uint256 expectedLockedMargin = reopenMargin - PerpMath.fee(reopenNotional, 10);

        PerpEngine.ModifyResult memory modified = engine.modifyPosition(
            PerpEngine.ModifyRequest({
                positionId: oldPositionId,
                newOwnerCommitment: newPositionId,
                expectedLockedMarginUsd: uint128(expectedLockedMargin),
                externalFeeUsd: uint128(externalFee),
                newLeverageBps: 10_000,
                acceptableClosePriceX18: 2_490e18,
                acceptableOpenPriceX18: 2_510e18,
                deadline: uint64(block.timestamp + 1 hours)
            })
        );
        require(modified.realizedPnlUsd == pnl, "modify pnl");
        require(modified.lockedMarginUsd == expectedLockedMargin, "modify margin");
        require(engine.getPosition(oldPositionId).openedAt == 0, "old key remains");
        PerpEngine.Position memory nextPosition = engine.getPosition(newPositionId);
        require(nextPosition.ownerCommitment == newPositionId, "new key missing");
        require(nextPosition.notionalUsd == reopenNotional, "modify notional");
        require(engine.marketRisk(WETH_PERP).longOpenInterestUsd == reopenNotional, "modify OI");
    }

    function testVaultSettlesPositionAndPreservesLpAccounting() external {
        registry.registerMarket(WETH_PERP, _marketConfig());
        MockERC20 usdg = new MockERC20("USDG", "USDG");

        InsuranceFund insuranceImplementation = new InsuranceFund();
        InsuranceFund insurance = InsuranceFund(
            address(
                new ERC1967Proxy(
                    address(insuranceImplementation),
                    abi.encodeCall(
                        InsuranceFund.initialize,
                        (address(this), address(this), address(this), address(usdg))
                    )
                )
            )
        );
        LiquidityVaultUSDG vaultImplementation = new LiquidityVaultUSDG();
        LiquidityVaultUSDG vault = LiquidityVaultUSDG(
            address(
                new ERC1967Proxy(
                    address(vaultImplementation),
                    abi.encodeCall(
                        LiquidityVaultUSDG.initialize,
                        (
                            address(this),
                            address(this),
                            address(this),
                            address(usdg),
                            address(engine),
                            address(insurance),
                            uint128(5e6),
                            uint64(1 hours),
                            uint16(5_000)
                        )
                    )
                )
            )
        );
        engine.setRole(engine.SETTLEMENT_ROLE(), address(vault), true);
        insurance.setRole(insurance.VAULT_ROLE(), address(vault), true);
        vault.setPaused(false, false, false);

        usdg.mint(address(this), 6e6);
        usdg.approve(address(vault), type(uint256).max);
        uint256 lpShares = vault.deposit(5e6, address(this));
        require(lpShares == 5e6, "initial shares");

        bytes32 positionId = keccak256("vault-position-1");
        vault.openPublicPosition(
            PerpEngine.OpenRequest({
                positionId: positionId,
                ownerCommitment: keccak256("vault-owner-1"),
                marketId: WETH_PERP,
                marginUsd: 100_000,
                leverageBps: 20_000,
                acceptablePriceX18: 2_510e18,
                deadline: uint64(block.timestamp + 1 hours),
                isLong: true
            })
        );
        require(vault.traderMarginLiability() == 99_800, "margin liability");
        require(vault.reservedProfitLiquidity() == 200_000, "profit reserve");
        require(insurance.assets() == 100, "open insurance fee");

        feed.setRound(2750e8, block.timestamp, 1);
        vault.closePublicPosition(
            positionId,
            keccak256("vault-payout-1"),
            2_700e18,
            uint64(block.timestamp + 1 hours),
            address(this)
        );
        require(vault.traderMarginLiability() == 0, "margin remains");
        require(vault.reservedProfitLiquidity() == 0, "reserve remains");
        require(insurance.assets() > 100, "close insurance fee");

        feed.setRound(2500e8, block.timestamp, 1);
        bytes32 liquidatedPositionId = keccak256("vault-position-2");
        vault.openPublicPosition(
            PerpEngine.OpenRequest({
                positionId: liquidatedPositionId,
                ownerCommitment: keccak256("vault-owner-2"),
                marketId: WETH_PERP,
                marginUsd: 100_000,
                leverageBps: 20_000,
                acceptablePriceX18: 2_510e18,
                deadline: uint64(block.timestamp + 1 hours),
                isLong: true
            })
        );
        feed.setRound(1500e8, block.timestamp, 1);
        PerpEngine.LiquidationResult memory liquidation = vault.liquidatePublicPosition(
            liquidatedPositionId, keccak256("liquidation-residual-1")
        );
        require(liquidation.keeperRewardUsd > 0, "keeper reward");
        require(vault.traderMarginLiability() == 0, "liquidation margin remains");
        require(vault.reservedProfitLiquidity() == 0, "liquidation reserve remains");

        vm.warp(block.timestamp + 1 hours);
        uint256 redeemed = vault.redeem(lpShares, address(this));
        require(redeemed > 0, "lp redeem");
        require(vault.totalShares() == 0, "shares remain");
    }

    function _marketConfig() private pure returns (PerpTypes.MarketConfig memory) {
        return PerpTypes.MarketConfig({
            baseAsset: address(0xBEEF),
            oracleId: ETH_USD,
            maxOpenInterestUsd: 1e6,
            maxSkewUsd: 500_000,
            maxPositionUsd: 250_000,
            minPositionUsd: 10_000,
            maxLeverageBps: 20_000,
            maintenanceMarginBps: 2_000,
            positionFeeBps: 10,
            liquidationFeeBps: 200,
            maxPriceImpactBps: 100,
            enabled: true
        });
    }
}

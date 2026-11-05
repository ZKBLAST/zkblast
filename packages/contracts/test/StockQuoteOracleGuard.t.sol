// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";
import { IStockQuoteAssetRegistry } from "../src/stock/IStockQuoteAssetRegistry.sol";
import { StockQuoteAssetRegistry } from "../src/stock/StockQuoteAssetRegistry.sol";
import { StockQuoteOracleGuard } from "../src/stock/StockQuoteOracleGuard.sol";

interface VmStockQuoteOracle {
    function warp(uint256 timestamp) external;
}

contract GuardTokenMock {
    uint8 public constant decimals = 18;
}

contract GuardFeedMock {
    uint8 public constant decimals = 8;
    uint80 public roundId = 1;
    int256 public answer = 250e8;
    uint256 public updatedAt;
    uint80 public answeredInRound = 1;

    constructor() {
        updatedAt = block.timestamp;
    }

    function setObservation(
        uint80 roundId_,
        int256 answer_,
        uint256 updatedAt_,
        uint80 answeredInRound_
    ) external {
        roundId = roundId_;
        answer = answer_;
        updatedAt = updatedAt_;
        answeredInRound = answeredInRound_;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, updatedAt, updatedAt, answeredInRound);
    }
}

contract StockQuoteOracleGuardTest {
    VmStockQuoteOracle private constant VM =
        VmStockQuoteOracle(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct Fixture {
        StockQuoteAssetRegistry registry;
        StockQuoteOracleGuard guard;
        GuardTokenMock token;
        GuardFeedMock feed;
    }

    function _buyAllowed(Fixture memory f) private returns (bool allowed) {
        (allowed,) = address(f.guard).call(
            abi.encodeCall(
                f.guard.requireOperationAllowed,
                (address(f.token), StockQuoteOracleGuard.Operation.BUY)
            )
        );
    }

    function _fixture() private returns (Fixture memory f) {
        VM.warp(1_800_000_000);
        StockQuoteAssetRegistry registryImplementation = new StockQuoteAssetRegistry();
        f.registry = StockQuoteAssetRegistry(
            address(
                new ERC1967Proxy(
                    address(registryImplementation),
                    abi.encodeCall(
                        StockQuoteAssetRegistry.initialize, (address(this), address(this))
                    )
                )
            )
        );
        f.token = new GuardTokenMock();
        f.feed = new GuardFeedMock();
        f.registry
            .list(
                address(f.token),
                IStockQuoteAssetRegistry.QuoteAssetConfig({
                    enabled: true,
                    quoteTradingEnabled: true,
                    graduationEnabled: true,
                    priceFeed: address(f.feed),
                    tokenDecimals: 18,
                    maxOracleAge: 1 hours,
                    maxOracleDeviationBps: 500,
                    maxLaunchQuoteExposure: 1_000 ether,
                    maxPoolQuoteExposure: 10_000 ether,
                    issuerAssetId: keccak256("robinhood:AAPL")
                })
            );
        StockQuoteOracleGuard guardImplementation = new StockQuoteOracleGuard();
        f.guard = StockQuoteOracleGuard(
            address(
                new ERC1967Proxy(
                    address(guardImplementation),
                    abi.encodeCall(
                        StockQuoteOracleGuard.initialize,
                        (address(this), address(this), address(this), f.registry)
                    )
                )
            )
        );
        f.guard
            .setSessionPolicy(
                address(f.token),
                StockQuoteOracleGuard.MarketState.ACTIVE,
                1 ether,
                false,
                uint64(block.timestamp)
            );
    }

    function testActiveObservationUsesPriceAndMultiplierOnce() external {
        Fixture memory f = _fixture();
        f.guard
            .setSessionPolicy(
                address(f.token),
                StockQuoteOracleGuard.MarketState.ACTIVE,
                2 ether,
                false,
                uint64(block.timestamp)
            );
        StockQuoteOracleGuard.Observation memory observation = f.guard
            .validatedUsdNotional(address(f.token), StockQuoteOracleGuard.Operation.BUY, 1 ether);
        require(observation.priceX18 == 250 ether, "price");
        require(observation.notionalX18 == 500 ether, "notional");
        require(observation.multiplierX18 == 2 ether, "multiplier");
    }

    function testPolicyIdentityChangesWithSessionVersion() external {
        Fixture memory f = _fixture();
        bytes32 initialIdentity = f.guard.policyIdentity(address(f.token));
        require(initialIdentity != bytes32(0), "missing identity");
        require(
            f.guard.validateCreate(address(f.token)) == initialIdentity,
            "create identity mismatch"
        );
        f.guard.setSessionPolicy(
            address(f.token),
            StockQuoteOracleGuard.MarketState.AFTER_HOURS,
            1 ether,
            true,
            uint64(block.timestamp)
        );
        bytes32 nextIdentity = f.guard.policyIdentity(address(f.token));
        require(nextIdentity != initialIdentity, "session version not bound");
        require(
            f.guard.validateBuy(address(f.token), 1 ether) == nextIdentity,
            "buy identity mismatch"
        );
    }

    function testClosedAndHaltedMarketsKeepExitAvailable() external {
        Fixture memory f = _fixture();
        f.guard
            .setSessionPolicy(
                address(f.token),
                StockQuoteOracleGuard.MarketState.CLOSED,
                1 ether,
                false,
                uint64(block.timestamp)
            );
        (bool buy,) = address(f.guard)
            .call(
                abi.encodeCall(
                    f.guard.requireOperationAllowed,
                    (address(f.token), StockQuoteOracleGuard.Operation.BUY)
                )
            );
        require(!buy, "closed buy accepted");
        f.guard.requireOperationAllowed(address(f.token), StockQuoteOracleGuard.Operation.SELL);
        f.guard.requireOperationAllowed(address(f.token), StockQuoteOracleGuard.Operation.EXIT);

        f.guard
            .setSessionPolicy(
                address(f.token),
                StockQuoteOracleGuard.MarketState.HALTED,
                1 ether,
                false,
                uint64(block.timestamp)
            );
        f.guard.requireOperationAllowed(address(f.token), StockQuoteOracleGuard.Operation.EXIT);
    }

    function testDisabledAssetBlocksExposureButPreservesSellAndExit() external {
        Fixture memory f = _fixture();
        f.registry.disable(address(f.token));
        f.guard.requireOperationAllowed(address(f.token), StockQuoteOracleGuard.Operation.SELL);
        f.guard.requireOperationAllowed(address(f.token), StockQuoteOracleGuard.Operation.EXIT);
        (bool buyAllowed,) = address(f.guard).call(
            abi.encodeCall(
                StockQuoteOracleGuard.requireOperationAllowed,
                (address(f.token), StockQuoteOracleGuard.Operation.BUY)
            )
        );
        require(!buyAllowed, "disabled asset accepted new exposure");
    }

    function testRejectsStaleInvalidAndOverLimitObservations() external {
        Fixture memory f = _fixture();
        f.feed.setObservation(1, 250e8, block.timestamp - 2 hours, 1);
        (bool stale,) = address(f.guard)
            .call(
                abi.encodeCall(
                    f.guard.validatedUsdNotional,
                    (address(f.token), StockQuoteOracleGuard.Operation.BUY, 1 ether)
                )
            );
        require(!stale, "stale observation accepted");

        f.feed.setObservation(2, -1, block.timestamp, 2);
        (bool invalid,) = address(f.guard)
            .call(
                abi.encodeCall(
                    f.guard.validatedUsdNotional,
                    (address(f.token), StockQuoteOracleGuard.Operation.BUY, 1 ether)
                )
            );
        require(!invalid, "negative observation accepted");

        f.feed.setObservation(3, 250e8, block.timestamp, 3);
        (bool overLimit,) = address(f.guard)
            .call(
                abi.encodeCall(
                    f.guard.validatedUsdNotional,
                    (address(f.token), StockQuoteOracleGuard.Operation.BUY, 5 ether)
                )
            );
        require(!overLimit, "exposure limit bypassed");
    }

    function testRejectsZeroFutureAndIncompleteOracleRounds() external {
        Fixture memory f = _fixture();
        f.feed.setObservation(2, 0, block.timestamp, 2);
        (bool zeroAnswer,) = address(f.guard).call(
            abi.encodeCall(
                f.guard.validatedUsdNotional,
                (address(f.token), StockQuoteOracleGuard.Operation.BUY, 1 ether)
            )
        );
        require(!zeroAnswer, "zero answer accepted");

        f.feed.setObservation(3, 250e8, block.timestamp + 1, 3);
        (bool futureObservation,) = address(f.guard).call(
            abi.encodeCall(
                f.guard.validatedUsdNotional,
                (address(f.token), StockQuoteOracleGuard.Operation.BUY, 1 ether)
            )
        );
        require(!futureObservation, "future observation accepted");

        f.feed.setObservation(4, 250e8, block.timestamp, 3);
        (bool incompleteRound,) = address(f.guard).call(
            abi.encodeCall(
                f.guard.validatedUsdNotional,
                (address(f.token), StockQuoteOracleGuard.Operation.BUY, 1 ether)
            )
        );
        require(!incompleteRound, "incomplete round accepted");
    }

    function testMarketStateMatrixAndEmergencyRecoveryFailClosed() external {
        Fixture memory f = _fixture();
        StockQuoteOracleGuard.MarketState[4] memory blockedStates = [
            StockQuoteOracleGuard.MarketState.CLOSED,
            StockQuoteOracleGuard.MarketState.HALTED,
            StockQuoteOracleGuard.MarketState.DEGRADED,
            StockQuoteOracleGuard.MarketState.EMERGENCY
        ];
        for (uint256 i; i < blockedStates.length; ++i) {
            f.guard.setSessionPolicy(
                address(f.token), blockedStates[i], 1 ether, false, uint64(block.timestamp)
            );
            require(!_buyAllowed(f), "blocked state accepted buy");
            f.guard.requireOperationAllowed(address(f.token), StockQuoteOracleGuard.Operation.EXIT);
        }

        f.guard.setSessionPolicy(
            address(f.token),
            StockQuoteOracleGuard.MarketState.ACTIVE,
            1 ether,
            false,
            uint64(block.timestamp)
        );
        require(_buyAllowed(f), "active recovery did not restore buy");

        (bool futurePolicy,) = address(f.guard).call(
            abi.encodeCall(
                f.guard.setSessionPolicy,
                (
                    address(f.token),
                    StockQuoteOracleGuard.MarketState.ACTIVE,
                    uint128(1 ether),
                    false,
                    uint64(block.timestamp + 1)
                )
            )
        );
        require(!futurePolicy, "future session policy accepted");
    }

    function testAfterHoursBuyRequiresExplicitPolicy() external {
        Fixture memory f = _fixture();
        f.guard
            .setSessionPolicy(
                address(f.token),
                StockQuoteOracleGuard.MarketState.AFTER_HOURS,
                1 ether,
                false,
                uint64(block.timestamp)
            );
        (bool disabled,) = address(f.guard)
            .call(
                abi.encodeCall(
                    f.guard.requireOperationAllowed,
                    (address(f.token), StockQuoteOracleGuard.Operation.BUY)
                )
            );
        require(!disabled, "after-hours buy enabled implicitly");

        f.guard
            .setSessionPolicy(
                address(f.token),
                StockQuoteOracleGuard.MarketState.AFTER_HOURS,
                1 ether,
                true,
                uint64(block.timestamp)
            );
        f.guard.requireOperationAllowed(address(f.token), StockQuoteOracleGuard.Operation.BUY);
    }

    function testRejectsReferenceDeviationAndStaleSessionForNewExposure() external {
        Fixture memory f = _fixture();
        require(f.guard.validateReferenceDeviation(address(f.token), 251 ether) == 40, "deviation");
        (bool excessiveDeviation,) = address(f.guard)
            .call(abi.encodeCall(f.guard.validateReferenceDeviation, (address(f.token), 300 ether)));
        require(!excessiveDeviation, "excessive deviation accepted");

        VM.warp(block.timestamp + 2 hours);
        (bool staleBuy,) = address(f.guard)
            .call(
                abi.encodeCall(
                    f.guard.requireOperationAllowed,
                    (address(f.token), StockQuoteOracleGuard.Operation.BUY)
                )
            );
        require(!staleBuy, "stale session buy accepted");
        StockQuoteOracleGuard.MarketState state =
            f.guard.requireOperationAllowed(address(f.token), StockQuoteOracleGuard.Operation.EXIT);
        require(state == StockQuoteOracleGuard.MarketState.DEGRADED, "stale state");
    }
}

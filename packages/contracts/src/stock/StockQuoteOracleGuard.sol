// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { IAggregatorV3 } from "../perps/interfaces/IAggregatorV3.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { IStockQuoteAssetRegistry } from "./IStockQuoteAssetRegistry.sol";
import { IStockQuoteExecutionGuard } from "./IStockQuoteExecutionGuard.sol";
import { StockQuoteMath } from "./StockQuoteMath.sol";

/// @notice Validates stock-token reference observations and explicit market-session policy.
/// @dev The equity reference values exposure; it is not the DBC launch-token marginal price.
contract StockQuoteOracleGuard is ProtocolAccess, UUPSUpgradeable, IStockQuoteExecutionGuard {
    error InvalidGuardConfig();
    error SessionPolicyNotConfigured();
    error OperationUnavailable(Operation operation, MarketState state);
    error InvalidOracleObservation();
    error StaleOracleObservation(uint256 updatedAt, uint256 maximumAge);
    error ExposureLimitExceeded(uint256 notionalX18, uint256 maximumNotionalX18);
    error OracleDeviationExceeded(uint256 deviationBps, uint256 maximumDeviationBps);

    bytes32 public constant ORACLE_ADMIN_ROLE = keccak256("ZKBLAST_STOCK_QUOTE_ORACLE_ADMIN_ROLE");

    enum MarketState {
        ACTIVE,
        AFTER_HOURS,
        CLOSED,
        HALTED,
        DEGRADED,
        EMERGENCY
    }

    enum Operation {
        CREATE_LAUNCH,
        FUND,
        BUY,
        SELL,
        GRADUATE,
        EXIT
    }

    struct SessionPolicy {
        MarketState state;
        uint64 observedAt;
        uint128 multiplierX18;
        bool afterHoursBuyEnabled;
        bool configured;
    }

    struct Observation {
        uint256 priceX18;
        uint256 notionalX18;
        uint64 updatedAt;
        uint80 roundId;
        MarketState marketState;
        uint128 multiplierX18;
    }

    struct FeedObservation {
        uint256 answer;
        uint256 priceX18;
        uint64 updatedAt;
        uint80 roundId;
        uint8 decimals;
    }

    IStockQuoteAssetRegistry public registry;
    mapping(address asset => SessionPolicy policy) private _sessions;
    mapping(address asset => uint32 version) public sessionVersion;

    event SessionPolicyUpdated(
        address indexed asset,
        MarketState indexed state,
        uint128 multiplierX18,
        bool afterHoursBuyEnabled,
        uint64 observedAt,
        uint32 version
    );

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        address upgrader,
        address oracleAdmin,
        IStockQuoteAssetRegistry registry_
    ) external initializer {
        if (
            oracleAdmin == address(0) || address(registry_) == address(0)
                || address(registry_).code.length == 0
        ) revert InvalidGuardConfig();
        __ProtocolAccess_init(admin, upgrader);
        _setRole(ORACLE_ADMIN_ROLE, oracleAdmin, true);
        registry = registry_;
    }

    function setSessionPolicy(
        address asset,
        MarketState state,
        uint128 multiplierX18,
        bool afterHoursBuyEnabled,
        uint64 observedAt
    ) external onlyRole(ORACLE_ADMIN_ROLE) {
        registry.quoteAssetConfig(asset);
        if (
            multiplierX18 == 0 || observedAt == 0 || observedAt > block.timestamp
                || (state != MarketState.AFTER_HOURS && afterHoursBuyEnabled)
        ) revert InvalidGuardConfig();
        uint32 version = sessionVersion[asset] + 1;
        sessionVersion[asset] = version;
        _sessions[asset] = SessionPolicy({
            state: state,
            observedAt: observedAt,
            multiplierX18: multiplierX18,
            afterHoursBuyEnabled: afterHoursBuyEnabled,
            configured: true
        });
        emit SessionPolicyUpdated(
            asset, state, multiplierX18, afterHoursBuyEnabled, observedAt, version
        );
    }

    function sessionPolicy(address asset) external view returns (SessionPolicy memory) {
        return _session(asset);
    }

    /// @notice Validates whether an operation may proceed without requiring a fresh USD value.
    /// @dev Legitimate SELL/EXIT paths can remain available during closure/halt/degradation.
    function requireOperationAllowed(address asset, Operation operation)
        public
        view
        returns (MarketState state)
    {
        IStockQuoteAssetRegistry.QuoteAssetConfig memory config = registry.quoteAssetConfig(asset);
        SessionPolicy memory policy = _session(asset);
        bool staleSession = block.timestamp - policy.observedAt > config.maxOracleAge;
        state = staleSession ? MarketState.DEGRADED : policy.state;
        bool createsExposure = operation == Operation.CREATE_LAUNCH || operation == Operation.FUND
            || operation == Operation.BUY || operation == Operation.GRADUATE;
        if (
            (!config.enabled && createsExposure)
                || ((operation == Operation.CREATE_LAUNCH
                        || operation == Operation.FUND
                        || operation == Operation.BUY)
                    && !config.quoteTradingEnabled)
                || (operation == Operation.GRADUATE && !config.graduationEnabled)
                || !_allowed(policy, state, operation)
        ) {
            revert OperationUnavailable(operation, state);
        }
    }

    /// @notice Returns a fresh multiplier-adjusted USD observation for capped exposure operations.
    function validatedUsdNotional(address asset, Operation operation, uint256 rawAmount)
        public
        view
        returns (Observation memory observation)
    {
        MarketState state = requireOperationAllowed(asset, operation);
        IStockQuoteAssetRegistry.QuoteAssetConfig memory config = registry.quoteAssetConfig(asset);
        SessionPolicy memory policy = _session(asset);
        FeedObservation memory feed = _feedObservation(config);
        uint256 notionalX18 = StockQuoteMath.usdNotionalX18(
            rawAmount, config.tokenDecimals, feed.answer, feed.decimals, policy.multiplierX18
        );
        uint256 maximum = operation == Operation.GRADUATE
            ? uint256(config.maxPoolQuoteExposure)
            : uint256(config.maxLaunchQuoteExposure);
        if (notionalX18 > maximum) revert ExposureLimitExceeded(notionalX18, maximum);
        observation = Observation({
            priceX18: feed.priceX18,
            notionalX18: notionalX18,
            updatedAt: feed.updatedAt,
            roundId: feed.roundId,
            marketState: state,
            multiplierX18: policy.multiplierX18
        });
    }

    function validateBuy(address quoteAsset, uint256 quoteAmountRaw)
        external
        view
        returns (bytes32)
    {
        validatedUsdNotional(quoteAsset, Operation.BUY, quoteAmountRaw);
        return policyIdentity(quoteAsset);
    }

    function validateCreate(address quoteAsset) external view returns (bytes32) {
        requireOperationAllowed(quoteAsset, Operation.CREATE_LAUNCH);
        return policyIdentity(quoteAsset);
    }

    function validateSell(address quoteAsset) external view returns (bytes32) {
        requireOperationAllowed(quoteAsset, Operation.SELL);
        return policyIdentity(quoteAsset);
    }

    function validateGraduate(address quoteAsset, uint256 quoteAmountRaw)
        external
        view
        returns (bytes32)
    {
        validatedUsdNotional(quoteAsset, Operation.GRADUATE, quoteAmountRaw);
        return policyIdentity(quoteAsset);
    }

    function policyIdentity(address quoteAsset) public view returns (bytes32) {
        IStockQuoteAssetRegistry.QuoteAssetConfig memory config =
            registry.quoteAssetConfig(quoteAsset);
        SessionPolicy memory policy = _session(quoteAsset);
        return keccak256(
            abi.encode(
                block.chainid,
                address(this),
                address(registry),
                quoteAsset,
                registry.assetVersion(quoteAsset),
                registry.configurationHash(config),
                sessionVersion[quoteAsset],
                policy
            )
        );
    }

    /// @notice Compares another authenticated stock/USD observation with the onchain feed.
    /// @dev This must not be used to compare a launch-token DBC price to the equity price.
    function validateReferenceDeviation(address asset, uint256 comparisonPriceX18)
        external
        view
        returns (uint256 deviationBps)
    {
        if (comparisonPriceX18 == 0) revert InvalidOracleObservation();
        IStockQuoteAssetRegistry.QuoteAssetConfig memory config = registry.quoteAssetConfig(asset);
        FeedObservation memory feed = _feedObservation(config);
        uint256 difference = comparisonPriceX18 > feed.priceX18
            ? comparisonPriceX18 - feed.priceX18
            : feed.priceX18 - comparisonPriceX18;
        deviationBps = StockQuoteMath.mulDiv(difference, 10_000, feed.priceX18);
        if (deviationBps > config.maxOracleDeviationBps) {
            revert OracleDeviationExceeded(deviationBps, config.maxOracleDeviationBps);
        }
    }

    function _allowed(SessionPolicy memory policy, MarketState effectiveState, Operation operation)
        private
        pure
        returns (bool)
    {
        if (effectiveState == MarketState.ACTIVE) return true;
        if (effectiveState == MarketState.AFTER_HOURS) {
            return operation == Operation.SELL || operation == Operation.EXIT
                || (operation == Operation.BUY && policy.afterHoursBuyEnabled);
        }
        if (
            effectiveState == MarketState.CLOSED || effectiveState == MarketState.HALTED
                || effectiveState == MarketState.DEGRADED
        ) return operation == Operation.SELL || operation == Operation.EXIT;
        return operation == Operation.EXIT;
    }

    function _feedObservation(IStockQuoteAssetRegistry.QuoteAssetConfig memory config)
        private
        view
        returns (FeedObservation memory observation)
    {
        IAggregatorV3 feed = IAggregatorV3(config.priceFeed);
        uint8 feedDecimals = feed.decimals();
        if (feedDecimals > 36) revert InvalidOracleObservation();
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) =
            feed.latestRoundData();
        if (
            roundId == 0 || answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp
                || answeredInRound < roundId || updatedAt > type(uint64).max
        ) revert InvalidOracleObservation();
        if (block.timestamp - updatedAt > config.maxOracleAge) {
            revert StaleOracleObservation(updatedAt, config.maxOracleAge);
        }
        uint256 value = uint256(answer);
        uint256 priceX18 = feedDecimals == 18
            ? value
            : feedDecimals < 18
                ? value * (10 ** (18 - feedDecimals))
                : value / (10 ** (feedDecimals - 18));
        observation = FeedObservation({
            answer: value,
            priceX18: priceX18,
            updatedAt: uint64(updatedAt),
            roundId: roundId,
            decimals: feedDecimals
        });
    }

    function _session(address asset) private view returns (SessionPolicy memory policy) {
        policy = _sessions[asset];
        if (!policy.configured) revert SessionPolicyNotConfigured();
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

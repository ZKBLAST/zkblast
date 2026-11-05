// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ProtocolAccess} from "../access/ProtocolAccess.sol";
import {IERC20Minimal} from "../interfaces/IERC20Minimal.sol";
import {FullMath} from "../math/FullMath.sol";
import {UUPSUpgradeable} from "../proxy/UUPSUpgradeable.sol";
import {AssistanceFundTypes} from "./AssistanceFundTypes.sol";

interface IAssistanceReferenceOracle {
    /// @return outputPerInputX18 Output-token units per input-token unit, normalized to 18 decimals.
    function referencePrice(address inputAsset, address outputAsset)
        external
        view
        returns (uint256 outputPerInputX18, uint64 updatedAt, uint32 observations);
}

contract BuybackRouteRegistry is ProtocolAccess, UUPSUpgradeable {
    uint256 private constant BPS = 10_000;

    enum PoolModel {
        DAMM,
        DLMM
    }

    struct Route {
        address inputAsset;
        address outputAsset;
        address pool;
        address router;
        address adapter;
        address oracle;
        AssistanceFundTypes.ExecutionLimits limits;
        PoolModel model;
        uint8 inputDecimals;
        uint8 outputDecimals;
        uint16 minimumOracleObservations;
        uint16 maximumBinCrossings;
        bool token0ToToken1;
        bool enabled;
    }

    struct SpendWindow {
        uint64 day;
        uint64 lastExecutionAt;
        uint256 spent;
    }

    struct ExecutionRequest {
        uint256 amountIn;
        uint256 minimumAmountOut;
        uint256 quotedAmountOut;
        uint256 spotProbeAmountIn;
        uint256 spotProbeAmountOut;
        uint256 deadline;
    }

    error InvalidRoute();
    error RouteDisabled();
    error InvalidExecution();
    error StaleReferencePrice();
    error InsufficientObservations();
    error InsufficientPoolLiquidity();
    error ExecutionLimitExceeded();
    error PriceDeviationExceeded();

    mapping(bytes32 routeId => Route route) private _routes;
    mapping(bytes32 routeId => SpendWindow window) public spendWindow;

    event RouteConfigured(bytes32 indexed routeId, address indexed inputAsset, address indexed pool);
    event RouteStatusChanged(bytes32 indexed routeId, bool enabled);
    event RouteBudgetConsumed(bytes32 indexed routeId, uint256 amountIn, uint256 dailySpent);

    constructor() {
        _disableInitializers();
    }

    function initialize(address governanceTimelock) external initializer {
        if (governanceTimelock == address(0) || governanceTimelock.code.length == 0) {
            revert InvalidRoute();
        }
        __ProtocolAccess_init(governanceTimelock, governanceTimelock);
    }

    function configureRoute(bytes32 routeId, Route calldata config) external onlyRole(DEFAULT_ADMIN_ROLE) {
        AssistanceFundTypes.ExecutionLimits calldata limits = config.limits;
        if (
            routeId == bytes32(0) || config.inputAsset == address(0) || config.outputAsset == address(0)
                || config.inputAsset == config.outputAsset || config.pool.code.length == 0
                || config.router.code.length == 0 || config.adapter.code.length == 0 || config.oracle.code.length == 0
                || limits.minimumAmount == 0 || limits.maximumAmount < limits.minimumAmount
                || limits.maximumDailySpend < limits.maximumAmount || limits.minimumPoolLiquidity == 0
                || limits.cooldownSeconds == 0 || limits.oracleStalenessSeconds == 0 || limits.swapDeadlineSeconds == 0
                || limits.maximumSlippageBps == 0 || limits.maximumSlippageBps >= BPS
                || limits.maximumPriceImpactBps == 0 || limits.maximumPriceImpactBps >= BPS
                || limits.maximumOracleDeviationBps == 0 || limits.maximumOracleDeviationBps >= BPS
                || config.minimumOracleObservations < 2 || config.inputDecimals > 18 || config.outputDecimals > 18
                || (config.model == PoolModel.DLMM && config.maximumBinCrossings == 0)
        ) revert InvalidRoute();
        Route storage existing = _routes[routeId];
        if (existing.inputAsset != address(0)) {
            if (
                existing.inputAsset != config.inputAsset || existing.outputAsset != config.outputAsset
                    || existing.pool != config.pool || existing.router != config.router
                    || existing.adapter != config.adapter || existing.model != config.model
                    || existing.token0ToToken1 != config.token0ToToken1
            ) revert InvalidRoute();
        }
        _routes[routeId] = config;
        emit RouteConfigured(routeId, config.inputAsset, config.pool);
    }

    function setRouteEnabled(bytes32 routeId, bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Route storage config = _routes[routeId];
        if (config.inputAsset == address(0)) revert InvalidRoute();
        config.enabled = enabled;
        emit RouteStatusChanged(routeId, enabled);
    }

    function consumeAndValidate(bytes32 routeId, ExecutionRequest calldata request)
        external
        returns (uint256 referencePriceX18, uint256 executionPriceX18)
    {
        Route storage config = _routes[routeId];
        if (msg.sender != config.adapter) revert InvalidRoute();
        if (!config.enabled) revert RouteDisabled();
        if (
            request.deadline < block.timestamp || request.deadline > block.timestamp + config.limits.swapDeadlineSeconds
                || request.amountIn < config.limits.minimumAmount || request.amountIn > config.limits.maximumAmount
                || request.minimumAmountOut == 0 || request.quotedAmountOut < request.minimumAmountOut
                || request.spotProbeAmountIn == 0 || request.spotProbeAmountOut == 0
                || request.minimumAmountOut * BPS < request.quotedAmountOut * (BPS - config.limits.maximumSlippageBps)
        ) revert InvalidExecution();
        if (IERC20Minimal(config.inputAsset).balanceOf(config.pool) < config.limits.minimumPoolLiquidity) {
            revert InsufficientPoolLiquidity();
        }

        uint64 updatedAt;
        uint32 observations;
        (referencePriceX18, updatedAt, observations) =
            IAssistanceReferenceOracle(config.oracle).referencePrice(config.inputAsset, config.outputAsset);
        if (
            referencePriceX18 == 0 || updatedAt > block.timestamp
                || block.timestamp - updatedAt > config.limits.oracleStalenessSeconds
        ) revert StaleReferencePrice();
        if (observations < config.minimumOracleObservations) revert InsufficientObservations();

        uint256 normalizedInput = request.amountIn * (10 ** (18 - config.inputDecimals));
        uint256 normalizedOutput = request.quotedAmountOut * (10 ** (18 - config.outputDecimals));
        executionPriceX18 = FullMath.mulDiv(normalizedOutput, 1e18, normalizedInput);
        uint256 normalizedSpotInput = request.spotProbeAmountIn * (10 ** (18 - config.inputDecimals));
        uint256 normalizedSpotOutput = request.spotProbeAmountOut * (10 ** (18 - config.outputDecimals));
        uint256 spotPriceX18 = FullMath.mulDiv(normalizedSpotOutput, 1e18, normalizedSpotInput);
        if (
            executionPriceX18 < spotPriceX18
                && FullMath.mulDiv(spotPriceX18 - executionPriceX18, BPS, spotPriceX18)
                    > config.limits.maximumPriceImpactBps
        ) revert PriceDeviationExceeded();
        uint256 difference = executionPriceX18 > referencePriceX18
            ? executionPriceX18 - referencePriceX18
            : referencePriceX18 - executionPriceX18;
        if (FullMath.mulDiv(difference, BPS, referencePriceX18) > config.limits.maximumOracleDeviationBps) {
            revert PriceDeviationExceeded();
        }

        SpendWindow storage window = spendWindow[routeId];
        uint64 currentDay = uint64(block.timestamp / 1 days);
        if (window.day != currentDay) {
            window.day = currentDay;
            window.spent = 0;
        }
        if (
            (window.lastExecutionAt != 0 && block.timestamp < window.lastExecutionAt + config.limits.cooldownSeconds)
                || window.spent + request.amountIn > config.limits.maximumDailySpend
        ) revert ExecutionLimitExceeded();
        window.lastExecutionAt = uint64(block.timestamp);
        window.spent += request.amountIn;
        emit RouteBudgetConsumed(routeId, request.amountIn, window.spent);
    }

    function getRoute(bytes32 routeId) external view returns (Route memory) {
        return _routes[routeId];
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}

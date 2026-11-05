// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ProtocolAccess} from "../access/ProtocolAccess.sol";
import {IERC20Minimal} from "../interfaces/IERC20Minimal.sol";
import {TokenTransfer} from "../libraries/TokenTransfer.sol";
import {UUPSUpgradeable} from "../proxy/UUPSUpgradeable.sol";
import {ReentrancyGuard} from "../security/ReentrancyGuard.sol";
import {AssistanceFeeCollector} from "./AssistanceFeeCollector.sol";
import {BurnModule} from "./BurnModule.sol";
import {BuybackRouteRegistry} from "./BuybackRouteRegistry.sol";
import {CanonicalBuybackRouterAdapter} from "./CanonicalBuybackRouterAdapter.sol";
import {IAssistanceFundEvents} from "./IAssistanceFundEvents.sol";

/// @notice Permissionless trigger that atomically spends allocated revenue, swaps and burns.
contract AssistanceFundExecutor is ProtocolAccess, UUPSUpgradeable, ReentrancyGuard, IAssistanceFundEvents {
    using TokenTransfer for address;

    AssistanceFeeCollector public collector;
    BuybackRouteRegistry public routeRegistry;
    BurnModule public burnModule;
    address public protocolToken;
    bool public paused;

    event ExecutionPauseChanged(bool paused);
    event DirectProtocolTokenBurned(uint256 amount, address indexed caller);

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address governanceTimelock,
        AssistanceFeeCollector collector_,
        BuybackRouteRegistry routeRegistry_,
        BurnModule burnModule_
    ) external initializer {
        address token = address(burnModule_.protocolToken());
        if (
            governanceTimelock.code.length == 0 || address(collector_).code.length == 0
                || address(routeRegistry_).code.length == 0 || address(burnModule_).code.length == 0
                || token.code.length == 0
        ) revert ExecutionUnavailable();
        __ProtocolAccess_init(governanceTimelock, governanceTimelock);
        collector = collector_;
        routeRegistry = routeRegistry_;
        burnModule = burnModule_;
        protocolToken = token;
    }

    function executeBuyback(bytes32 routeId, uint256 amountIn, uint256 minimumAmountOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 amountBurned)
    {
        if (paused) revert ExecutionUnavailable();
        BuybackRouteRegistry.Route memory route = routeRegistry.getRoute(routeId);
        if (route.outputAsset != protocolToken || route.adapter.code.length == 0 || route.inputAsset == address(0)) {
            revert ExecutionUnavailable();
        }

        collector.releaseBuyback(route.inputAsset, address(this), amountIn);
        route.inputAsset.forceApprove(route.adapter, amountIn);
        uint256 outputBefore = IERC20Minimal(protocolToken).balanceOf(address(this));
        (uint256 reportedOutput, uint256 referencePriceX18, uint256 executionPriceX18) =
            CanonicalBuybackRouterAdapter(route.adapter).execute(routeId, amountIn, minimumAmountOut, deadline);
        route.inputAsset.forceApprove(route.adapter, 0);
        amountBurned = IERC20Minimal(protocolToken).balanceOf(address(this)) - outputBefore;
        if (amountBurned != reportedOutput || amountBurned < minimumAmountOut) {
            revert ExecutionUnavailable();
        }

        protocolToken.pushExact(address(burnModule), amountBurned);
        burnModule.burn(amountBurned);
        emit BuybackExecuted(
            routeId,
            route.inputAsset,
            protocolToken,
            amountIn,
            amountBurned,
            referencePriceX18,
            executionPriceX18,
            msg.sender
        );
    }

    /// @notice Burns protocol-token revenue that is already allocated to buybacks.
    /// @dev This avoids routing ZKBLAST through a meaningless ZKBLAST-to-ZKBLAST swap.
    function executeDirectBurn(uint256 amount) external nonReentrant returns (uint256 totalSupplyAfter) {
        if (paused || amount == 0) revert ExecutionUnavailable();
        collector.releaseBuyback(protocolToken, address(this), amount);
        protocolToken.pushExact(address(burnModule), amount);
        totalSupplyAfter = burnModule.burn(amount);
        emit DirectProtocolTokenBurned(amount, msg.sender);
    }

    function setPaused(bool paused_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        paused = paused_;
        emit ExecutionPauseChanged(paused_);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}

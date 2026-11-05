// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {DammPool} from "../core/DammPool.sol";
import {DlmmPool} from "../core/DlmmPool.sol";
import {IERC20Minimal} from "../interfaces/IERC20Minimal.sol";
import {TokenTransfer} from "../libraries/TokenTransfer.sol";
import {PoolQuoter} from "../router/PoolQuoter.sol";
import {SwapRouter} from "../router/SwapRouter.sol";
import {ReentrancyGuard} from "../security/ReentrancyGuard.sol";
import {BuybackRouteRegistry} from "./BuybackRouteRegistry.sol";

/// @notice Executes one registered ZKBLAST buyback route without arbitrary-call capability.
contract CanonicalBuybackRouterAdapter is ReentrancyGuard {
    using TokenTransfer for address;

    BuybackRouteRegistry public immutable registry;
    PoolQuoter public immutable quoter;
    address public immutable assistanceFund;

    error InvalidExecution();

    event CanonicalBuybackExecuted(
        bytes32 indexed routeId,
        address indexed inputAsset,
        address indexed outputAsset,
        uint256 amountIn,
        uint256 amountOut,
        uint256 referencePriceX18,
        uint256 quotedExecutionPriceX18
    );

    constructor(BuybackRouteRegistry registry_, PoolQuoter quoter_, address assistanceFund_) {
        if (
            address(registry_).code.length == 0 || address(quoter_).code.length == 0 || assistanceFund_.code.length == 0
        ) revert InvalidExecution();
        registry = registry_;
        quoter = quoter_;
        assistanceFund = assistanceFund_;
    }

    function execute(bytes32 routeId, uint256 amountIn, uint256 minimumAmountOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 amountOut, uint256 referencePriceX18, uint256 executionPriceX18)
    {
        if (msg.sender != assistanceFund) revert InvalidExecution();
        BuybackRouteRegistry.Route memory route = registry.getRoute(routeId);
        uint256 quotedAmountOut = _quote(route, amountIn);
        uint256 spotProbeAmountOut = _quote(route, route.limits.minimumAmount);
        BuybackRouteRegistry.ExecutionRequest memory request = BuybackRouteRegistry.ExecutionRequest({
            amountIn: amountIn,
            minimumAmountOut: minimumAmountOut,
            quotedAmountOut: quotedAmountOut,
            spotProbeAmountIn: route.limits.minimumAmount,
            spotProbeAmountOut: spotProbeAmountOut,
            deadline: deadline
        });
        (referencePriceX18, executionPriceX18) = registry.consumeAndValidate(routeId, request);

        route.inputAsset.pullExact(msg.sender, amountIn);
        route.inputAsset.forceApprove(route.router, amountIn);
        uint256 outputBefore = IERC20Minimal(route.outputAsset).balanceOf(msg.sender);
        amountOut = _swap(route, amountIn, minimumAmountOut, deadline);
        route.inputAsset.forceApprove(route.router, 0);
        uint256 received = IERC20Minimal(route.outputAsset).balanceOf(msg.sender) - outputBefore;
        if (amountOut != received || received < minimumAmountOut) revert InvalidExecution();
        emit CanonicalBuybackExecuted(
            routeId, route.inputAsset, route.outputAsset, amountIn, received, referencePriceX18, executionPriceX18
        );
    }

    function _quote(BuybackRouteRegistry.Route memory route, uint256 amountIn)
        private
        view
        returns (uint256 amountOut)
    {
        if (route.model == BuybackRouteRegistry.PoolModel.DAMM) {
            (amountOut,) = quoter.quoteDammExactInput(DammPool(route.pool), route.inputAsset, amountIn);
        } else {
            (amountOut,,) = quoter.quoteDlmmExactInput(
                DlmmPool(route.pool), route.token0ToToken1, amountIn, route.maximumBinCrossings
            );
        }
    }

    function _swap(
        BuybackRouteRegistry.Route memory route,
        uint256 amountIn,
        uint256 minimumAmountOut,
        uint256 deadline
    ) private returns (uint256 amountOut) {
        if (route.model == BuybackRouteRegistry.PoolModel.DAMM) {
            return SwapRouter(route.router)
                .swapDammExactInput(
                    DammPool(route.pool), route.inputAsset, amountIn, minimumAmountOut, assistanceFund, deadline
                );
        }
        return SwapRouter(route.router)
            .swapDlmmExactInput(
                DlmmPool(route.pool),
                route.token0ToToken1,
                amountIn,
                minimumAmountOut,
                route.maximumBinCrossings,
                assistanceFund,
                deadline
            );
    }
}

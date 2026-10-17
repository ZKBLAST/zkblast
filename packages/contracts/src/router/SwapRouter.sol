// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { DammPool } from "../core/DammPool.sol";
import { DlmmPool } from "../core/DlmmPool.sol";
import { PoolRegistry } from "../core/PoolRegistry.sol";
import { TokenTransfer } from "../libraries/TokenTransfer.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { ReentrancyGuard } from "../security/ReentrancyGuard.sol";

contract SwapRouter is ProtocolAccess, UUPSUpgradeable, ReentrancyGuard {
    using TokenTransfer for address;

    error InvalidPool();

    PoolRegistry public registry;

    event SwapRouted(
        address indexed sender,
        address indexed pool,
        address indexed recipient,
        uint256 amountIn,
        uint256 amountOut
    );

    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address upgrader, PoolRegistry registry_)
        external
        initializer
    {
        if (address(registry_) == address(0)) revert InvalidPool();
        __ProtocolAccess_init(admin, upgrader);
        registry = registry_;
    }

    function swapDammExactInput(
        DammPool pool,
        address tokenIn,
        uint256 amountIn,
        uint256 minimumAmountOut,
        address recipient,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        _validatePool(address(pool));
        tokenIn.pullExact(msg.sender, amountIn);
        tokenIn.forceApprove(address(pool), amountIn);
        amountOut = pool.swapExactInput(tokenIn, amountIn, minimumAmountOut, recipient, deadline);
        tokenIn.forceApprove(address(pool), 0);
        emit SwapRouted(msg.sender, address(pool), recipient, amountIn, amountOut);
    }

    function swapDlmmExactInput(
        DlmmPool pool,
        bool token0ToToken1,
        uint256 amountIn,
        uint256 minimumAmountOut,
        uint16 maximumBinCrossings,
        address recipient,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        _validatePool(address(pool));
        address tokenIn = token0ToToken1 ? pool.token0() : pool.token1();
        tokenIn.pullExact(msg.sender, amountIn);
        tokenIn.forceApprove(address(pool), amountIn);
        (amountOut,) = pool.swapExactInput(
            token0ToToken1, amountIn, minimumAmountOut, maximumBinCrossings, recipient, deadline
        );
        tokenIn.forceApprove(address(pool), 0);
        emit SwapRouted(msg.sender, address(pool), recipient, amountIn, amountOut);
    }

    function _validatePool(address pool) private view {
        if (!registry.isRegisteredPool(pool)) revert InvalidPool();
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

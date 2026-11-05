// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20Minimal } from "../interfaces/IERC20Minimal.sol";
import { ReentrancyGuard } from "../security/ReentrancyGuard.sol";
import { AssistanceFeeCollector } from "./AssistanceFeeCollector.sol";
import { AssistanceFundTypes } from "./AssistanceFundTypes.sol";
import { IAmmProtocolFeeSource } from "./IProtocolRevenueSources.sol";
import { RevenueForwarderBase } from "./RevenueForwarderBase.sol";

/// @notice Single-pool adapter shared by DAMM and DLMM protocol-fee surfaces.
contract AmmProtocolFeeAdapter is RevenueForwarderBase, ReentrancyGuard {
    IAmmProtocolFeeSource public immutable pool;
    address public immutable token0;
    address public immutable token1;
    bytes32 public immutable adapterId0;
    bytes32 public immutable adapterId1;

    constructor(
        AssistanceFeeCollector collector_,
        IAmmProtocolFeeSource pool_,
        bytes32 adapterId0_,
        bytes32 adapterId1_
    ) RevenueForwarderBase(collector_) {
        if (
            address(pool_) == address(0) || address(pool_).code.length == 0
                || adapterId0_ == bytes32(0) || adapterId1_ == bytes32(0)
        ) revert InvalidSource();
        address token0_ = pool_.token0();
        address token1_ = pool_.token1();
        if (
            token0_ == address(0) || token0_.code.length == 0 || token1_ == address(0)
                || token1_.code.length == 0 || token0_ == token1_
        ) revert InvalidSource();
        pool = pool_;
        token0 = token0_;
        token1 = token1_;
        adapterId0 = adapterId0_;
        adapterId1 = adapterId1_;
    }

    function collect() external nonReentrant returns (uint256 amount0, uint256 amount1) {
        if (pool.protocolFeeRecipient() != address(this)) revert InvalidSource();
        uint256 before0 = IERC20Minimal(token0).balanceOf(address(this));
        uint256 before1 = IERC20Minimal(token1).balanceOf(address(this));
        (amount0, amount1) = pool.collectProtocolFees();
        if (
            IERC20Minimal(token0).balanceOf(address(this)) - before0 != amount0
                || IERC20Minimal(token1).balanceOf(address(this)) - before1 != amount1
        ) revert UnsupportedTokenBehavior();
        if (amount0 == 0 && amount1 == 0) revert InvalidAmount();

        uint64 epoch = _nextEpoch();
        if (amount0 != 0) {
            _forward(
                address(pool),
                token0,
                adapterId0,
                epoch,
                AssistanceFundTypes.RevenueKind.PROTOCOL_POOL_FEE,
                amount0
            );
        }
        if (amount1 != 0) {
            _forward(
                address(pool),
                token1,
                adapterId1,
                epoch,
                AssistanceFundTypes.RevenueKind.PROTOCOL_POOL_FEE,
                amount1
            );
        }
    }
}

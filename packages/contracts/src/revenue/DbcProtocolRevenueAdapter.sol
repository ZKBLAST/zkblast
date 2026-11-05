// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20Minimal } from "../interfaces/IERC20Minimal.sol";
import { ReentrancyGuard } from "../security/ReentrancyGuard.sol";
import { AssistanceFeeCollector } from "./AssistanceFeeCollector.sol";
import { AssistanceFundTypes } from "./AssistanceFundTypes.sol";
import { IDbcProtocolFeeSource } from "./IProtocolRevenueSources.sol";
import { RevenueForwarderBase } from "./RevenueForwarderBase.sol";

/// @notice Single-pool adapter for standalone standard or Protected DBC protocol fees.
contract DbcProtocolRevenueAdapter is RevenueForwarderBase, ReentrancyGuard {
    uint8 private constant PROTOCOL_ALLOCATION = 2;

    IDbcProtocolFeeSource public immutable pool;
    address public immutable asset;
    bytes32 public immutable adapterId;

    constructor(AssistanceFeeCollector collector_, IDbcProtocolFeeSource pool_, bytes32 adapterId_)
        RevenueForwarderBase(collector_)
    {
        if (
            address(pool_) == address(0) || address(pool_).code.length == 0
                || adapterId_ == bytes32(0)
        ) revert InvalidSource();
        address asset_ = pool_.quoteToken();
        if (asset_ == address(0) || asset_.code.length == 0) revert InvalidSource();
        pool = pool_;
        asset = asset_;
        adapterId = adapterId_;
    }

    function collect() external nonReentrant returns (uint256 amount) {
        uint256 beforeBalance = IERC20Minimal(asset).balanceOf(address(this));
        amount = pool.claimFees(PROTOCOL_ALLOCATION);
        uint256 received = IERC20Minimal(asset).balanceOf(address(this)) - beforeBalance;
        if (amount == 0 || amount != received) revert UnsupportedTokenBehavior();
        _forward(
            address(pool),
            asset,
            adapterId,
            _nextEpoch(),
            AssistanceFundTypes.RevenueKind.PROTOCOL_TRADE_FEE,
            amount
        );
    }
}

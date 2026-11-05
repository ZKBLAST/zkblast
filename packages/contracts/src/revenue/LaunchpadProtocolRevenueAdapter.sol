// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20Minimal } from "../interfaces/IERC20Minimal.sol";
import { ReentrancyGuard } from "../security/ReentrancyGuard.sol";
import { AssistanceFeeCollector } from "./AssistanceFeeCollector.sol";
import { AssistanceFundTypes } from "./AssistanceFundTypes.sol";
import { ILaunchpadRevenueSplitter } from "./IProtocolRevenueSources.sol";
import { RevenueForwarderBase } from "./RevenueForwarderBase.sol";

/// @notice Forwards only this adapter's protocol claim from future launchpad snapshots.
contract LaunchpadProtocolRevenueAdapter is RevenueForwarderBase, ReentrancyGuard {
    ILaunchpadRevenueSplitter public immutable splitter;
    address public immutable asset;
    bytes32 public immutable adapterId;

    constructor(
        AssistanceFeeCollector collector_,
        ILaunchpadRevenueSplitter splitter_,
        address asset_,
        bytes32 adapterId_
    ) RevenueForwarderBase(collector_) {
        if (
            address(splitter_) == address(0) || address(splitter_).code.length == 0
                || asset_ == address(0) || asset_.code.length == 0 || adapterId_ == bytes32(0)
        ) revert InvalidSource();
        splitter = splitter_;
        asset = asset_;
        adapterId = adapterId_;
    }

    function collect(bytes32 snapshotId) external nonReentrant returns (uint256 amount) {
        uint256 beforeBalance = IERC20Minimal(asset).balanceOf(address(this));
        amount = splitter.claim(snapshotId);
        uint256 received = IERC20Minimal(asset).balanceOf(address(this)) - beforeBalance;
        if (amount == 0 || amount != received) revert UnsupportedTokenBehavior();
        _forward(
            address(splitter),
            asset,
            adapterId,
            _nextEpoch(),
            AssistanceFundTypes.RevenueKind.PROTOCOL_TRADE_FEE,
            amount
        );
    }
}

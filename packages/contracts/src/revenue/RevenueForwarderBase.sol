// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { TokenTransfer } from "../libraries/TokenTransfer.sol";
import { AssistanceFeeCollector } from "./AssistanceFeeCollector.sol";
import { AssistanceFundTypes } from "./AssistanceFundTypes.sol";
import { IAssistanceFundEvents } from "./IAssistanceFundEvents.sol";

/// @notice Shared exact-approval and collector forwarding logic for immutable adapters.
abstract contract RevenueForwarderBase is IAssistanceFundEvents {
    using TokenTransfer for address;

    AssistanceFeeCollector public immutable collector;
    uint64 public forwardingEpoch;

    event ProtocolRevenueForwarded(
        address indexed origin,
        bytes32 indexed sourceId,
        bytes32 indexed epochId,
        address asset,
        uint256 amount
    );

    constructor(AssistanceFeeCollector collector_) {
        if (address(collector_) == address(0) || address(collector_).code.length == 0) {
            revert InvalidSource();
        }
        collector = collector_;
    }

    function _forward(
        address origin,
        address asset,
        bytes32 adapterId,
        uint64 epoch,
        AssistanceFundTypes.RevenueKind kind,
        uint256 amount
    ) internal {
        if (origin == address(0) || asset == address(0) || adapterId == bytes32(0) || amount == 0) {
            revert InvalidAmount();
        }
        bytes32 sourceId = collector.registry().sourceId(address(this), asset, adapterId);
        asset.forceApprove(address(collector), amount);
        (bytes32 epochId,) = collector.recordRevenue(sourceId, epoch, kind, amount, 0, amount);
        asset.forceApprove(address(collector), 0);
        emit ProtocolRevenueForwarded(origin, sourceId, epochId, asset, amount);
    }

    function _nextEpoch() internal returns (uint64 epoch) {
        epoch = forwardingEpoch + 1;
        forwardingEpoch = epoch;
    }
}

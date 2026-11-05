// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { AssistanceFundTypes } from "./AssistanceFundTypes.sol";

/// @notice Canonical errors and events shared by Assistance Fund contracts and indexers.
interface IAssistanceFundEvents {
    error InvalidSource();
    error InvalidAsset();
    error InvalidAmount();
    error InvalidAllocation();
    error InvalidExecutionLimits();
    error SourceInactive();
    error UnsupportedTokenBehavior();
    error AccountingInvariantViolated();
    error ExecutionUnavailable();
    error OracleUnavailable();
    error StaleOracle();
    error SlippageExceeded();
    error PriceImpactExceeded();
    error DailyLimitExceeded();
    error CooldownActive();
    error BurnFailed();

    event ProtocolFeeSourceUpdated(
        bytes32 indexed sourceId,
        address indexed source,
        address indexed asset,
        bytes32 adapterId,
        AssistanceFundTypes.SourceStatus status
    );
    event ProtocolRevenueRecorded(
        bytes32 indexed sourceId,
        bytes32 indexed epochId,
        address indexed asset,
        AssistanceFundTypes.RevenueKind kind,
        uint256 grossAmount,
        uint256 excludedObligations,
        uint256 eligibleAmount
    );
    event ProtocolFeeAllocated(
        bytes32 indexed sourceId,
        bytes32 indexed epochId,
        address indexed asset,
        uint256 eligibleAmount,
        uint256 buybackAmount,
        uint256 treasuryAmount
    );
    event BuybackExecuted(
        bytes32 indexed routeId,
        address indexed assetIn,
        address indexed protocolToken,
        uint256 amountIn,
        uint256 amountOut,
        uint256 referencePriceX18,
        uint256 executionPriceX18,
        address executor
    );
    event ProtocolTokensBurned(
        address indexed protocolToken,
        AssistanceFundTypes.BurnMethod method,
        uint256 amount,
        uint256 totalSupplyBefore,
        uint256 totalSupplyAfter,
        address indexed executor
    );
    event TreasuryClaimed(address indexed asset, address indexed recipient, uint256 amount);
}

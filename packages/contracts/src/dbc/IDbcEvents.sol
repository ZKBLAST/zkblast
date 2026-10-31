// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DbcTypes } from "./DbcTypes.sol";

/// @notice Canonical event surface used by contracts, indexer, API, and SDK.
interface IDbcEvents {
    event LaunchTemplateCreated(
        uint256 indexed templateId,
        bytes32 indexed familyId,
        uint32 indexed version,
        bytes32 configHash
    );
    event LaunchTemplateStatusUpdated(uint256 indexed templateId, bool enabled);

    event TokenLaunched(
        bytes32 indexed launchId,
        uint256 indexed templateId,
        address indexed creator,
        address token,
        address virtualPool,
        address quoteToken,
        uint256 baseInventoryRaw,
        uint256 graduationThresholdRaw
    );
    event LaunchMetadataPublished(
        bytes32 indexed launchId,
        string name,
        string symbol,
        string metadataURI,
        address indexed creatorTokenRecipient
    );

    event CurveSwapExecuted(
        bytes32 indexed launchId,
        address indexed sender,
        address indexed recipient,
        bool isBuy,
        uint256 amountInRaw,
        uint256 amountOutRaw,
        uint256 feeRaw,
        uint256 finalPriceX18,
        uint256 realQuoteReserveRaw,
        uint256 baseSoldRaw
    );

    event FeeAccrued(
        bytes32 indexed launchId,
        uint256 creatorAmountRaw,
        uint256 partnerAmountRaw,
        uint256 protocolAmountRaw
    );
    event FeeClaimed(
        bytes32 indexed launchId,
        address indexed recipient,
        uint8 indexed allocation,
        uint256 amountRaw
    );

    event LifecycleUpdated(
        bytes32 indexed launchId,
        DbcTypes.Lifecycle previousLifecycle,
        DbcTypes.Lifecycle nextLifecycle
    );
    event GraduationReady(
        bytes32 indexed launchId, uint256 realQuoteReserveRaw, uint256 thresholdRaw
    );
    event GraduationPrepared(
        bytes32 indexed launchId,
        bytes32 indexed migrationId,
        address indexed adapter,
        uint256 baseAmountRaw,
        uint256 quoteAmountRaw
    );
    event PoolGraduated(
        bytes32 indexed launchId,
        bytes32 indexed migrationId,
        address indexed destinationPool,
        uint256 destinationShares,
        uint256 baseUsedRaw,
        uint256 quoteUsedRaw
    );
    event LpAllocated(
        bytes32 indexed launchId,
        address indexed recipient,
        uint8 indexed allocation,
        uint256 shares,
        uint256 unlockTimestamp
    );
    event LpClaimed(bytes32 indexed launchId, address indexed recipient, uint256 shares);
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { LaunchpadTypes } from "./LaunchpadTypes.sol";

interface ILaunchpadRegistry {
    event LaunchpadCreated(
        uint256 indexed launchpadId,
        address indexed owner,
        address indexed treasury,
        bytes32 metadataHash,
        bytes32 slugCommitment,
        uint256 configPresetId,
        uint32 version
    );
    event LaunchpadMetadataUpdated(
        uint256 indexed launchpadId,
        bytes32 previousMetadataHash,
        bytes32 metadataHash,
        uint32 version
    );
    event LaunchpadOperatorUpdated(
        uint256 indexed launchpadId, address indexed previousOperator, address indexed operator
    );
    event LaunchpadOwnerProposed(
        uint256 indexed launchpadId, address indexed owner, address indexed pendingOwner
    );
    event LaunchpadOwnerProposalCancelled(uint256 indexed launchpadId, address indexed owner);
    event LaunchpadOwnerAccepted(
        uint256 indexed launchpadId, address indexed previousOwner, address indexed owner
    );
    event LaunchpadTreasuryProposed(
        uint256 indexed launchpadId, address indexed treasury, address indexed pendingTreasury
    );
    event LaunchpadTreasuryProposalCancelled(uint256 indexed launchpadId, address indexed treasury);
    event LaunchpadTreasuryAccepted(
        uint256 indexed launchpadId, address indexed previousTreasury, address indexed treasury
    );
    event LaunchpadStatusUpdated(
        uint256 indexed launchpadId,
        LaunchpadTypes.Status previousStatus,
        LaunchpadTypes.Status status
    );

    function registerLaunchpad(
        address owner,
        address treasury,
        bytes32 metadataHash,
        bytes32 slugCommitment,
        uint256 configPresetId
    ) external returns (uint256 launchpadId);

    function launchpad(uint256 launchpadId) external view returns (LaunchpadTypes.Record memory);

    function launchpads(uint256[] calldata launchpadIds)
        external
        view
        returns (LaunchpadTypes.Record[] memory records);
}

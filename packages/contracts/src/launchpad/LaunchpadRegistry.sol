// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { ILaunchpadRegistry } from "./ILaunchpadRegistry.sol";
import { LaunchpadTypes } from "./LaunchpadTypes.sol";

contract LaunchpadRegistry is ProtocolAccess, UUPSUpgradeable, ILaunchpadRegistry {
    error InvalidLaunchpad();
    error InvalidMetadata();
    error InvalidSlug();
    error InvalidStatusTransition();
    error SlugAlreadyRegistered();
    error NotLaunchpadOwner();
    error NotPendingOwner();
    error NotPendingTreasury();
    error NotOwnerOrOperator();
    error TimestampOverflow();

    uint256 public launchpadCount;
    mapping(uint256 launchpadId => LaunchpadTypes.Record record) private _launchpads;
    mapping(bytes32 slugCommitment => uint256 launchpadId) public launchpadBySlug;

    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address upgrader, address factory) external initializer {
        if (factory == address(0)) revert InvalidAccount();
        __ProtocolAccess_init(admin, upgrader);
        _setRole(FACTORY_ROLE, factory, true);
    }

    function registerLaunchpad(
        address owner,
        address treasury,
        bytes32 metadataHash,
        bytes32 slugCommitment,
        uint256 configPresetId
    ) external onlyRole(FACTORY_ROLE) returns (uint256 launchpadId) {
        if (owner == address(0) || treasury == address(0)) revert InvalidAccount();
        if (metadataHash == bytes32(0)) revert InvalidMetadata();
        if (slugCommitment == bytes32(0)) revert InvalidSlug();
        if (launchpadBySlug[slugCommitment] != 0) revert SlugAlreadyRegistered();
        if (configPresetId == 0) revert InvalidLaunchpad();

        launchpadId = ++launchpadCount;
        uint64 nowTimestamp = _timestamp();
        _launchpads[launchpadId] = LaunchpadTypes.Record({
            owner: owner,
            pendingOwner: address(0),
            treasury: treasury,
            pendingTreasury: address(0),
            operator: address(0),
            metadataHash: metadataHash,
            slugCommitment: slugCommitment,
            configPresetId: configPresetId,
            version: 1,
            status: LaunchpadTypes.Status.ACTIVE,
            createdAt: nowTimestamp,
            updatedAt: nowTimestamp
        });
        launchpadBySlug[slugCommitment] = launchpadId;
        emit LaunchpadCreated(
            launchpadId,
            owner,
            treasury,
            metadataHash,
            slugCommitment,
            configPresetId,
            1
        );
    }

    function launchpad(uint256 launchpadId)
        external
        view
        returns (LaunchpadTypes.Record memory)
    {
        return _record(launchpadId);
    }

    function launchpads(uint256[] calldata launchpadIds)
        external
        view
        returns (LaunchpadTypes.Record[] memory records)
    {
        records = new LaunchpadTypes.Record[](launchpadIds.length);
        for (uint256 index; index < launchpadIds.length; ++index) {
            records[index] = _record(launchpadIds[index]);
        }
    }

    function updateMetadata(uint256 launchpadId, bytes32 metadataHash) external {
        if (metadataHash == bytes32(0)) revert InvalidMetadata();
        LaunchpadTypes.Record storage record = _record(launchpadId);
        if (msg.sender != record.owner && msg.sender != record.operator) {
            revert NotOwnerOrOperator();
        }
        bytes32 previous = record.metadataHash;
        record.metadataHash = metadataHash;
        record.version += 1;
        record.updatedAt = _timestamp();
        emit LaunchpadMetadataUpdated(launchpadId, previous, metadataHash, record.version);
    }

    function setOperator(uint256 launchpadId, address operator) external {
        LaunchpadTypes.Record storage record = _record(launchpadId);
        _requireOwner(record);
        address previous = record.operator;
        record.operator = operator;
        record.updatedAt = _timestamp();
        emit LaunchpadOperatorUpdated(launchpadId, previous, operator);
    }

    function proposeOwner(uint256 launchpadId, address pendingOwner) external {
        if (pendingOwner == address(0)) revert InvalidAccount();
        LaunchpadTypes.Record storage record = _record(launchpadId);
        _requireOwner(record);
        record.pendingOwner = pendingOwner;
        record.updatedAt = _timestamp();
        emit LaunchpadOwnerProposed(launchpadId, record.owner, pendingOwner);
    }

    function cancelOwnerProposal(uint256 launchpadId) external {
        LaunchpadTypes.Record storage record = _record(launchpadId);
        _requireOwner(record);
        record.pendingOwner = address(0);
        record.updatedAt = _timestamp();
        emit LaunchpadOwnerProposalCancelled(launchpadId, record.owner);
    }

    function acceptOwner(uint256 launchpadId) external {
        LaunchpadTypes.Record storage record = _record(launchpadId);
        if (msg.sender != record.pendingOwner) revert NotPendingOwner();
        address previous = record.owner;
        record.owner = msg.sender;
        record.pendingOwner = address(0);
        record.operator = address(0);
        record.updatedAt = _timestamp();
        emit LaunchpadOwnerAccepted(launchpadId, previous, msg.sender);
    }

    function proposeTreasury(uint256 launchpadId, address pendingTreasury) external {
        if (pendingTreasury == address(0)) revert InvalidAccount();
        LaunchpadTypes.Record storage record = _record(launchpadId);
        _requireOwner(record);
        record.pendingTreasury = pendingTreasury;
        record.updatedAt = _timestamp();
        emit LaunchpadTreasuryProposed(launchpadId, record.treasury, pendingTreasury);
    }

    function cancelTreasuryProposal(uint256 launchpadId) external {
        LaunchpadTypes.Record storage record = _record(launchpadId);
        _requireOwner(record);
        record.pendingTreasury = address(0);
        record.updatedAt = _timestamp();
        emit LaunchpadTreasuryProposalCancelled(launchpadId, record.treasury);
    }

    function acceptTreasury(uint256 launchpadId) external {
        LaunchpadTypes.Record storage record = _record(launchpadId);
        if (msg.sender != record.pendingTreasury) revert NotPendingTreasury();
        address previous = record.treasury;
        record.treasury = msg.sender;
        record.pendingTreasury = address(0);
        record.updatedAt = _timestamp();
        emit LaunchpadTreasuryAccepted(launchpadId, previous, msg.sender);
    }

    function setCreationPaused(uint256 launchpadId, bool paused)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        LaunchpadTypes.Record storage record = _record(launchpadId);
        if (record.status == LaunchpadTypes.Status.DISABLED) revert InvalidStatusTransition();
        LaunchpadTypes.Status next =
            paused ? LaunchpadTypes.Status.PAUSED_CREATION : LaunchpadTypes.Status.ACTIVE;
        _setStatus(launchpadId, record, next);
    }

    function disable(uint256 launchpadId) external {
        LaunchpadTypes.Record storage record = _record(launchpadId);
        _requireOwner(record);
        _setStatus(launchpadId, record, LaunchpadTypes.Status.DISABLED);
    }

    function _setStatus(
        uint256 launchpadId,
        LaunchpadTypes.Record storage record,
        LaunchpadTypes.Status status
    ) private {
        LaunchpadTypes.Status previous = record.status;
        if (previous == status || previous == LaunchpadTypes.Status.NONE) {
            revert InvalidStatusTransition();
        }
        record.status = status;
        record.updatedAt = _timestamp();
        emit LaunchpadStatusUpdated(launchpadId, previous, status);
    }

    function _record(uint256 launchpadId)
        private
        view
        returns (LaunchpadTypes.Record storage record)
    {
        record = _launchpads[launchpadId];
        if (record.status == LaunchpadTypes.Status.NONE) revert InvalidLaunchpad();
    }

    function _requireOwner(LaunchpadTypes.Record storage record) private view {
        if (msg.sender != record.owner) revert NotLaunchpadOwner();
    }

    function _timestamp() private view returns (uint64 value) {
        if (block.timestamp > type(uint64).max) revert TimestampOverflow();
        value = uint64(block.timestamp);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

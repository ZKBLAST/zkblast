// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { AssistanceFundTypes } from "./AssistanceFundTypes.sol";
import { IAssistanceFundEvents } from "./IAssistanceFundEvents.sol";

/// @notice Append-only catalog of contracts authorized to report protocol-owned revenue.
/// @dev Governance can disable or re-enable a record but cannot rewrite its identity.
contract ProtocolFeeRegistry is ProtocolAccess, UUPSUpgradeable, IAssistanceFundEvents {
    error SourceAlreadyRegistered();
    error SourceNotRegistered();

    struct SourceRecord {
        uint256 chainId;
        address source;
        address asset;
        bytes32 adapterId;
        uint256 registeredAt;
        AssistanceFundTypes.SourceStatus status;
    }

    uint256 public registryChainId;
    mapping(bytes32 sourceId => SourceRecord record) private _sources;

    constructor() {
        _disableInitializers();
    }

    /// @dev The timelock owns both source lifecycle and upgrade authority.
    function initialize(address governanceTimelock) external initializer {
        __ProtocolAccess_init(governanceTimelock, governanceTimelock);
        registryChainId = block.chainid;
    }

    function sourceId(address source, address asset, bytes32 adapterId)
        public
        view
        returns (bytes32)
    {
        AssistanceFundTypes.SourceKey memory key = AssistanceFundTypes.SourceKey({
            chainId: registryChainId, source: source, asset: asset, adapterId: adapterId
        });
        return AssistanceFundTypes.sourceId(key, address(this));
    }

    function registerSource(address source, address asset, bytes32 adapterId)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        returns (bytes32 id)
    {
        if (
            source == address(0) || source.code.length == 0 || asset == address(0)
                || asset.code.length == 0 || adapterId == bytes32(0)
        ) revert InvalidSource();

        id = sourceId(source, asset, adapterId);
        if (_sources[id].source != address(0)) revert SourceAlreadyRegistered();
        _sources[id] = SourceRecord({
            chainId: registryChainId,
            source: source,
            asset: asset,
            adapterId: adapterId,
            registeredAt: block.timestamp,
            status: AssistanceFundTypes.SourceStatus.ACTIVE
        });
        emit ProtocolFeeSourceUpdated(
            id, source, asset, adapterId, AssistanceFundTypes.SourceStatus.ACTIVE
        );
    }

    function setSourceActive(bytes32 id, bool active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        SourceRecord storage item = _source(id);
        item.status = active
            ? AssistanceFundTypes.SourceStatus.ACTIVE
            : AssistanceFundTypes.SourceStatus.INACTIVE;
        emit ProtocolFeeSourceUpdated(id, item.source, item.asset, item.adapterId, item.status);
    }

    function sourceRecord(bytes32 id) external view returns (SourceRecord memory) {
        return _source(id);
    }

    function isActive(bytes32 id, address source_, address asset) external view returns (bool) {
        SourceRecord storage item = _sources[id];
        return item.status == AssistanceFundTypes.SourceStatus.ACTIVE && item.source == source_
            && item.asset == asset;
    }

    function _source(bytes32 id) private view returns (SourceRecord storage item) {
        item = _sources[id];
        if (item.source == address(0)) revert SourceNotRegistered();
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

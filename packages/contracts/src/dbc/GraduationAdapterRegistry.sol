// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { DbcTypes } from "./DbcTypes.sol";
import { IGraduationAdapter } from "./IGraduationAdapter.sol";

/// @notice Chain-local, versioned registry for reviewed graduation boundaries.
/// @dev Registration records are append-only. Governance may disable an entry but cannot rewrite it.
contract GraduationAdapterRegistry is ProtocolAccess, UUPSUpgradeable {
    error AdapterAlreadyRegistered();
    error AdapterContextInvalid();
    error AdapterNotRegistered();

    struct AdapterRecord {
        uint256 chainId;
        address adapter;
        address factory;
        address router;
        uint32 version;
        DbcTypes.MigrationMode mode;
        bytes32 configurationHash;
        bytes32 reviewReferenceHash;
        uint256 registeredAt;
        bool enabled;
    }

    uint256 public registryChainId;
    mapping(bytes32 recordId => AdapterRecord record) private _records;

    event AdapterRegistered(
        bytes32 indexed recordId,
        address indexed adapter,
        address indexed factory,
        address router,
        uint32 version,
        DbcTypes.MigrationMode mode,
        bytes32 configurationHash,
        bytes32 reviewReferenceHash
    );
    event AdapterStatusUpdated(bytes32 indexed recordId, bool enabled);

    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address upgrader) external initializer {
        __ProtocolAccess_init(admin, upgrader);
        registryChainId = block.chainid;
    }

    function recordId(address adapter, uint32 version) public view returns (bytes32) {
        return keccak256(abi.encode(registryChainId, address(this), adapter, version));
    }

    function register(address adapter, address router, bytes32 reviewReferenceHash)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        returns (bytes32 id)
    {
        if (
            adapter == address(0) || adapter.code.length == 0 || router == address(0)
                || router.code.length == 0 || reviewReferenceHash == bytes32(0)
        ) revert AdapterContextInvalid();
        IGraduationAdapter boundary = IGraduationAdapter(adapter);
        address factory = boundary.factory();
        uint32 version = boundary.adapterVersion();
        DbcTypes.MigrationMode mode = boundary.migrationMode();
        bytes32 configurationHash = boundary.configurationHash();
        if (
            factory == address(0) || factory.code.length == 0 || version == 0
                || configurationHash == bytes32(0)
        ) revert AdapterContextInvalid();
        id = recordId(adapter, version);
        if (_records[id].adapter != address(0)) revert AdapterAlreadyRegistered();
        _records[id] = AdapterRecord({
            chainId: registryChainId,
            adapter: adapter,
            factory: factory,
            router: router,
            version: version,
            mode: mode,
            configurationHash: configurationHash,
            reviewReferenceHash: reviewReferenceHash,
            registeredAt: block.timestamp,
            enabled: true
        });
        emit AdapterRegistered(
            id,
            adapter,
            factory,
            router,
            version,
            mode,
            configurationHash,
            reviewReferenceHash
        );
    }

    function setEnabled(bytes32 id, bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_records[id].adapter == address(0)) revert AdapterNotRegistered();
        _records[id].enabled = enabled;
        emit AdapterStatusUpdated(id, enabled);
    }

    function record(bytes32 id) external view returns (AdapterRecord memory) {
        AdapterRecord memory value = _records[id];
        if (value.adapter == address(0)) revert AdapterNotRegistered();
        return value;
    }

    function isEnabled(address adapter, uint32 version) external view returns (bool) {
        return _records[recordId(adapter, version)].enabled;
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

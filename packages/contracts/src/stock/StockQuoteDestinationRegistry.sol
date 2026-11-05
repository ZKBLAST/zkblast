// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { DbcTypes } from "../dbc/DbcTypes.sol";
import { IGraduationAdapter } from "../dbc/IGraduationAdapter.sol";
import { GraduationAdapterRegistry } from "../dbc/GraduationAdapterRegistry.sol";
import { IStockQuoteAssetRegistry } from "./IStockQuoteAssetRegistry.sol";

/// @notice Fail-closed, per-asset capability receipts for stock-quote graduation destinations.
/// @dev DAMM and DLMM are reviewed independently. Enabling one never enables the other.
contract StockQuoteDestinationRegistry is ProtocolAccess, UUPSUpgradeable {
    error CapabilityAlreadyRegistered();
    error CapabilityNotRegistered();
    error InvalidCapability();
    error StockQuoteGraduationDisabled();

    struct Capability {
        uint256 chainId;
        address quoteAsset;
        address adapter;
        address factory;
        uint32 adapterVersion;
        DbcTypes.MigrationMode mode;
        bytes32 adapterConfigurationHash;
        bytes32 reviewReferenceHash;
        bytes32 fundedAcceptanceHash;
        uint64 registeredAt;
        uint64 acceptedAt;
        bool enabled;
    }

    uint256 public registryChainId;
    IStockQuoteAssetRegistry public stockQuoteRegistry;
    GraduationAdapterRegistry public graduationAdapterRegistry;
    mapping(bytes32 capabilityId => Capability capability) private _capabilities;

    event DestinationCapabilityRegistered(
        bytes32 indexed capabilityId,
        address indexed quoteAsset,
        address indexed adapter,
        DbcTypes.MigrationMode mode,
        uint32 adapterVersion,
        address factory,
        bytes32 adapterConfigurationHash,
        bytes32 reviewReferenceHash
    );
    event DestinationCapabilityAccepted(
        bytes32 indexed capabilityId, bytes32 indexed fundedAcceptanceHash
    );
    event DestinationCapabilityDisabled(bytes32 indexed capabilityId);

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        address upgrader,
        IStockQuoteAssetRegistry stockQuoteRegistry_,
        GraduationAdapterRegistry graduationAdapterRegistry_
    ) external initializer {
        if (
            address(stockQuoteRegistry_) == address(0)
                || address(graduationAdapterRegistry_) == address(0)
                || address(stockQuoteRegistry_).code.length == 0
                || address(graduationAdapterRegistry_).code.length == 0
        ) revert InvalidCapability();
        __ProtocolAccess_init(admin, upgrader);
        registryChainId = block.chainid;
        stockQuoteRegistry = stockQuoteRegistry_;
        graduationAdapterRegistry = graduationAdapterRegistry_;
    }

    function capabilityId(address quoteAsset, DbcTypes.MigrationMode mode)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(registryChainId, address(this), quoteAsset, mode));
    }

    /// @notice Registers a reviewed destination but keeps it disabled until funded acceptance.
    function register(
        address quoteAsset,
        address adapter,
        bytes32 reviewReferenceHash
    ) external onlyRole(DEFAULT_ADMIN_ROLE) returns (bytes32 id) {
        if (
            quoteAsset == address(0) || adapter == address(0) || adapter.code.length == 0
                || reviewReferenceHash == bytes32(0)
        ) revert InvalidCapability();
        IStockQuoteAssetRegistry.QuoteAssetConfig memory asset =
            stockQuoteRegistry.quoteAssetConfig(quoteAsset);
        if (!asset.enabled || !asset.graduationEnabled) revert StockQuoteGraduationDisabled();

        IGraduationAdapter boundary = IGraduationAdapter(adapter);
        DbcTypes.MigrationMode mode = boundary.migrationMode();
        uint32 version = boundary.adapterVersion();
        address factory = boundary.factory();
        bytes32 configurationHash = boundary.configurationHash();
        if (
            version == 0 || factory == address(0) || factory.code.length == 0
                || configurationHash == bytes32(0)
                || !graduationAdapterRegistry.isEnabled(adapter, version)
        ) revert InvalidCapability();

        id = capabilityId(quoteAsset, mode);
        if (_capabilities[id].quoteAsset != address(0)) revert CapabilityAlreadyRegistered();
        _capabilities[id] = Capability({
            chainId: registryChainId,
            quoteAsset: quoteAsset,
            adapter: adapter,
            factory: factory,
            adapterVersion: version,
            mode: mode,
            adapterConfigurationHash: configurationHash,
            reviewReferenceHash: reviewReferenceHash,
            fundedAcceptanceHash: bytes32(0),
            registeredAt: uint64(block.timestamp),
            acceptedAt: 0,
            enabled: false
        });
        emit DestinationCapabilityRegistered(
            id,
            quoteAsset,
            adapter,
            mode,
            version,
            factory,
            configurationHash,
            reviewReferenceHash
        );
    }

    /// @notice Activates one exact mode only after a funded acceptance receipt is recorded.
    function accept(bytes32 id, bytes32 fundedAcceptanceHash)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        Capability storage item = _capability(id);
        if (fundedAcceptanceHash == bytes32(0)) revert InvalidCapability();
        IGraduationAdapter boundary = IGraduationAdapter(item.adapter);
        if (
            !graduationAdapterRegistry.isEnabled(item.adapter, item.adapterVersion)
                || boundary.factory() != item.factory
                || boundary.migrationMode() != item.mode
                || boundary.configurationHash() != item.adapterConfigurationHash
        ) revert InvalidCapability();
        IStockQuoteAssetRegistry.QuoteAssetConfig memory asset =
            stockQuoteRegistry.quoteAssetConfig(item.quoteAsset);
        if (!asset.enabled || !asset.graduationEnabled) revert StockQuoteGraduationDisabled();
        item.fundedAcceptanceHash = fundedAcceptanceHash;
        item.acceptedAt = uint64(block.timestamp);
        item.enabled = true;
        emit DestinationCapabilityAccepted(id, fundedAcceptanceHash);
    }

    function disable(bytes32 id) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Capability storage item = _capability(id);
        item.enabled = false;
        emit DestinationCapabilityDisabled(id);
    }

    function capability(bytes32 id) external view returns (Capability memory) {
        return _capability(id);
    }

    function isEnabled(address quoteAsset, DbcTypes.MigrationMode mode)
        external
        view
        returns (bool)
    {
        Capability memory value = _capabilities[capabilityId(quoteAsset, mode)];
        if (!value.enabled || value.fundedAcceptanceHash == bytes32(0)) return false;
        if (!graduationAdapterRegistry.isEnabled(value.adapter, value.adapterVersion)) return false;
        IStockQuoteAssetRegistry.QuoteAssetConfig memory asset =
            stockQuoteRegistry.quoteAssetConfig(quoteAsset);
        return asset.enabled && asset.graduationEnabled;
    }

    function isStockQuoteAsset(address quoteAsset) external view returns (bool) {
        try stockQuoteRegistry.quoteAssetConfig(quoteAsset) returns (
            IStockQuoteAssetRegistry.QuoteAssetConfig memory asset
        ) {
            return asset.issuerAssetId != bytes32(0);
        } catch {
            return false;
        }
    }

    function _capability(bytes32 id) private view returns (Capability storage value) {
        value = _capabilities[id];
        if (value.quoteAsset == address(0)) revert CapabilityNotRegistered();
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

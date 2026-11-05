// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { IStockQuoteAssetRegistry } from "./IStockQuoteAssetRegistry.sol";

/// @notice Chain-local allowlist for issuer-mapped stock-token quote assets.
/// @dev Symbols, names and logos are intentionally absent from the authorization boundary.
contract StockQuoteAssetRegistry is ProtocolAccess, UUPSUpgradeable, IStockQuoteAssetRegistry {
    error AssetAlreadyListed();
    error AssetNotListed();
    error InvalidAssetConfig();
    error TokenDecimalsMismatch(uint8 configured, uint8 observed);
    error QuoteTradingDisabled();
    error GraduationDisabled();

    uint16 private constant BPS = 10_000;
    bytes4 private constant DECIMALS_SELECTOR = 0x313ce567;

    struct AssetRecord {
        QuoteAssetConfig config;
        uint32 version;
        uint64 listedAt;
        uint64 updatedAt;
    }

    uint256 public registryChainId;
    mapping(address asset => AssetRecord record) private _records;

    event QuoteAssetListed(
        address indexed asset,
        bytes32 indexed issuerAssetId,
        address indexed priceFeed,
        uint32 version,
        bytes32 configurationHash
    );
    event QuoteAssetDisabled(address indexed asset, uint32 version);
    event QuoteAssetConfigUpdated(
        address indexed asset,
        uint32 version,
        bytes32 configurationHash,
        bool quoteTradingEnabled,
        bool graduationEnabled
    );

    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address upgrader) external initializer {
        __ProtocolAccess_init(admin, upgrader);
        registryChainId = block.chainid;
    }

    function list(address asset, QuoteAssetConfig calldata config)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (_records[asset].version != 0) revert AssetAlreadyListed();
        _validate(asset, config);
        uint64 timestamp = uint64(block.timestamp);
        _records[asset] =
            AssetRecord({ config: config, version: 1, listedAt: timestamp, updatedAt: timestamp });
        emit QuoteAssetListed(
            asset, config.issuerAssetId, config.priceFeed, 1, configurationHash(config)
        );
    }

    function update(address asset, QuoteAssetConfig calldata config)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        AssetRecord storage record = _record(asset);
        _validate(asset, config);
        uint32 version = record.version + 1;
        record.config = config;
        record.version = version;
        record.updatedAt = uint64(block.timestamp);
        emit QuoteAssetConfigUpdated(
            asset,
            version,
            configurationHash(config),
            config.quoteTradingEnabled,
            config.graduationEnabled
        );
    }

    /// @notice Stops new exposure while preserving the record for exits and reconciliation.
    function disable(address asset) external onlyRole(DEFAULT_ADMIN_ROLE) {
        AssetRecord storage record = _record(asset);
        QuoteAssetConfig memory config = record.config;
        if (!config.enabled && !config.quoteTradingEnabled && !config.graduationEnabled) return;
        config.enabled = false;
        config.quoteTradingEnabled = false;
        config.graduationEnabled = false;
        uint32 version = record.version + 1;
        record.config = config;
        record.version = version;
        record.updatedAt = uint64(block.timestamp);
        emit QuoteAssetDisabled(asset, version);
    }

    function quoteAssetConfig(address asset) external view returns (QuoteAssetConfig memory) {
        return _recordView(asset).config;
    }

    function assetRecord(address asset) external view returns (AssetRecord memory) {
        return _recordView(asset);
    }

    function assetVersion(address asset) external view returns (uint32) {
        return _recordView(asset).version;
    }

    function requireTradingEnabled(address asset)
        external
        view
        returns (QuoteAssetConfig memory config)
    {
        config = _recordView(asset).config;
        if (!config.enabled || !config.quoteTradingEnabled) revert QuoteTradingDisabled();
    }

    function requireGraduationEnabled(address asset)
        external
        view
        returns (QuoteAssetConfig memory config)
    {
        config = _recordView(asset).config;
        if (!config.enabled || !config.graduationEnabled) revert GraduationDisabled();
    }

    function configurationHash(QuoteAssetConfig memory config) public pure returns (bytes32) {
        return keccak256(abi.encode(config));
    }

    function _validate(address asset, QuoteAssetConfig calldata config) private view {
        if (
            asset == address(0) || asset.code.length == 0 || config.priceFeed == address(0)
                || config.priceFeed.code.length == 0 || config.issuerAssetId == bytes32(0)
                || config.tokenDecimals > 36 || config.maxOracleAge == 0
                || config.maxOracleDeviationBps > BPS || config.maxLaunchQuoteExposure == 0
                || config.maxPoolQuoteExposure < config.maxLaunchQuoteExposure
                || (!config.enabled && (config.quoteTradingEnabled || config.graduationEnabled))
        ) revert InvalidAssetConfig();

        (bool success, bytes memory result) =
            asset.staticcall(abi.encodeWithSelector(DECIMALS_SELECTOR));
        if (!success || result.length < 32) revert InvalidAssetConfig();
        uint256 observedValue = abi.decode(result, (uint256));
        if (observedValue > type(uint8).max) revert InvalidAssetConfig();
        uint8 observed = uint8(observedValue);
        if (observed != config.tokenDecimals) {
            revert TokenDecimalsMismatch(config.tokenDecimals, observed);
        }
    }

    function _record(address asset) private view returns (AssetRecord storage record) {
        record = _records[asset];
        if (record.version == 0) revert AssetNotListed();
    }

    function _recordView(address asset) private view returns (AssetRecord memory record) {
        record = _records[asset];
        if (record.version == 0) revert AssetNotListed();
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

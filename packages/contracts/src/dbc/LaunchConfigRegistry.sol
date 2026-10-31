// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { IERC20Metadata } from "../interfaces/IERC20Metadata.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { DbcTypes } from "./DbcTypes.sol";
import { DbcConfigStorage } from "./DbcConfigStorage.sol";
import { IDbcEvents } from "./IDbcEvents.sol";
import { SegmentedBondingCurveMath } from "./SegmentedBondingCurveMath.sol";

contract LaunchConfigRegistry is ProtocolAccess, UUPSUpgradeable, IDbcEvents {
    using DbcConfigStorage for DbcTypes.TemplateConfig;
    error InvalidTemplate();
    error QuoteTokenNotAllowed();
    error TemplateNotFound();

    bytes32 public constant TEMPLATE_ADMIN_ROLE = keccak256("ZKBLAST_DBC_TEMPLATE_ADMIN_ROLE");

    struct TemplateRecord {
        bytes32 familyId;
        bytes32 configHash;
        uint32 version;
        bool enabled;
        bool used;
        DbcTypes.TemplateConfig config;
    }

    uint256 public templateCount;
    mapping(bytes32 familyId => uint32 version) public latestVersion;
    mapping(address quoteToken => bool allowed) public quoteTokenAllowed;
    mapping(address quoteToken => uint8 decimals) public quoteTokenDecimals;
    mapping(uint256 templateId => TemplateRecord record) private _templates;

    event QuoteTokenStatusUpdated(address indexed quoteToken, uint8 decimals, bool allowed);
    event LaunchTemplateUsed(uint256 indexed templateId);

    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address upgrader, address templateAdmin)
        external
        initializer
    {
        if (templateAdmin == address(0)) revert InvalidAccount();
        __ProtocolAccess_init(admin, upgrader);
        _setRole(TEMPLATE_ADMIN_ROLE, templateAdmin, true);
    }

    function setQuoteToken(address quoteToken, bool allowed)
        external
        onlyRole(TEMPLATE_ADMIN_ROLE)
    {
        if (quoteToken == address(0) || quoteToken.code.length == 0) {
            revert QuoteTokenNotAllowed();
        }
        uint8 decimals = IERC20Metadata(quoteToken).decimals();
        if (decimals > 18) revert QuoteTokenNotAllowed();
        quoteTokenAllowed[quoteToken] = allowed;
        quoteTokenDecimals[quoteToken] = decimals;
        emit QuoteTokenStatusUpdated(quoteToken, decimals, allowed);
    }

    function createTemplate(bytes32 familyId, DbcTypes.TemplateConfig calldata config)
        external
        onlyRole(TEMPLATE_ADMIN_ROLE)
        returns (uint256 templateId)
    {
        _validate(config);
        uint32 version = latestVersion[familyId] + 1;
        latestVersion[familyId] = version;
        templateId = ++templateCount;
        bytes32 configHash = keccak256(abi.encode(config));
        TemplateRecord storage record = _templates[templateId];
        record.familyId = familyId;
        record.configHash = configHash;
        record.version = version;
        record.enabled = true;
        DbcTypes.TemplateConfig memory configSnapshot = config;
        record.config.write(configSnapshot);
        emit LaunchTemplateCreated(templateId, familyId, version, configHash);
        emit LaunchTemplateStatusUpdated(templateId, true);
    }

    function setTemplateEnabled(uint256 templateId, bool enabled)
        external
        onlyRole(TEMPLATE_ADMIN_ROLE)
    {
        TemplateRecord storage record = _record(templateId);
        record.enabled = enabled;
        emit LaunchTemplateStatusUpdated(templateId, enabled);
    }

    function markTemplateUsed(uint256 templateId) external onlyRole(FACTORY_ROLE) {
        TemplateRecord storage record = _record(templateId);
        if (!record.enabled) revert InvalidTemplate();
        if (record.used) return;
        record.used = true;
        emit LaunchTemplateUsed(templateId);
    }

    function template(uint256 templateId) external view returns (TemplateRecord memory) {
        return _record(templateId);
    }

    function templateConfig(uint256 templateId)
        external
        view
        returns (DbcTypes.TemplateConfig memory)
    {
        return _record(templateId).config;
    }

    function templateSummary(uint256 templateId)
        external
        view
        returns (
            bytes32 familyId,
            bytes32 configHash,
            uint32 version,
            bool enabled,
            bool used
        )
    {
        TemplateRecord storage record = _record(templateId);
        return (
            record.familyId,
            record.configHash,
            record.version,
            record.enabled,
            record.used
        );
    }

    function templateEconomics(uint256 templateId)
        external
        view
        returns (
            address quoteToken,
            uint128 totalSupplyRaw,
            uint128 baseInventoryRaw,
            uint128 graduationThresholdRaw,
            uint24 destinationFeePips,
            uint16 terminalPriceToleranceBps,
            uint16 tradeFeeBps,
            uint16 creatorFeeShareBps,
            uint16 partnerFeeShareBps,
            uint16 protocolFeeShareBps,
            uint16 creatorLpShareBps,
            uint32 creatorLockSeconds
        )
    {
        DbcTypes.TemplateConfig storage config = _record(templateId).config;
        return (
            config.quoteToken,
            config.totalSupplyRaw,
            config.baseInventoryRaw,
            config.graduationThresholdRaw,
            config.destinationFeePips,
            config.terminalPriceToleranceBps,
            config.fees.tradeFeeBps,
            config.fees.creatorShareBps,
            config.fees.partnerShareBps,
            config.fees.protocolShareBps,
            config.lp.creatorShareBps,
            config.lp.creatorLockSeconds
        );
    }

    function isEnabled(uint256 templateId) external view returns (bool) {
        return _record(templateId).enabled;
    }

    function _record(uint256 templateId) private view returns (TemplateRecord storage record) {
        record = _templates[templateId];
        if (record.version == 0) revert TemplateNotFound();
    }

    function _validate(DbcTypes.TemplateConfig calldata config) private view {
        if (
            !quoteTokenAllowed[config.quoteToken]
                || quoteTokenDecimals[config.quoteToken] != config.quoteDecimals
                || config.baseDecimals != 18 || config.protocolFeeRecipient == address(0)
                || config.protocolLpRecipient == address(0)
                || config.migrationMode != DbcTypes.MigrationMode.DAMM
                || config.destinationFeePips == 0 || config.destinationFeePips >= 1_000_000
                || config.terminalPriceToleranceBps == 0 || config.terminalPriceToleranceBps > 1_000
                || config.totalSupplyRaw == 0 || config.baseInventoryRaw == 0
                || config.baseInventoryRaw > config.totalSupplyRaw
                || config.graduationThresholdRaw == 0 || config.minimumDestinationShares == 0
                || config.fees.tradeFeeBps > DbcTypes.MAX_TRADE_FEE_BPS
                || uint256(config.fees.creatorShareBps) + config.fees.partnerShareBps
                        + config.fees.protocolShareBps != DbcTypes.BPS
                || uint256(config.lp.creatorShareBps) + config.lp.protocolShareBps != DbcTypes.BPS
        ) revert InvalidTemplate();
        if (SegmentedBondingCurveMath.validate(config.curve) != config.baseInventoryRaw) {
            revert InvalidTemplate();
        }
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

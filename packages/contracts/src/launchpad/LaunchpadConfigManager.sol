// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";

contract LaunchpadConfigManager is ProtocolAccess, UUPSUpgradeable {
    error InvalidPreset();
    error InvalidFeeCap();
    error QuoteTokenUnavailable();
    error DestinationUnavailable();
    error PresetNotFound();

    bytes32 public constant CONFIG_ADMIN_ROLE = keccak256("ZKBLAST_LAUNCHPAD_CONFIG_ADMIN_ROLE");
    uint16 public constant HARD_MAX_TOTAL_TRADE_FEE_BPS = 300;

    enum GraduationDestination {
        NONE,
        DAMM,
        DLMM
    }

    enum CreatorAccess {
        OWNER_OR_OPERATOR,
        PERMISSIONLESS
    }

    struct PresetInput {
        bytes32 familyId;
        uint256 dbcTemplateId;
        address quoteToken;
        uint16 maximumTotalTradeFeeBps;
        GraduationDestination graduationDestination;
        CreatorAccess creatorAccess;
        uint32 maximumLaunches;
    }

    struct Preset {
        bytes32 familyId;
        bytes32 configHash;
        uint256 dbcTemplateId;
        address quoteToken;
        uint16 maximumTotalTradeFeeBps;
        GraduationDestination graduationDestination;
        CreatorAccess creatorAccess;
        uint32 maximumLaunches;
        uint32 version;
        bool enabled;
        bool used;
    }

    uint16 public globalMaximumTotalTradeFeeBps;
    uint256 public presetCount;
    mapping(bytes32 familyId => uint32 version) public latestVersion;
    mapping(address quoteToken => bool allowed) public quoteTokenAllowed;
    mapping(GraduationDestination destination => bool supported) public destinationSupported;
    mapping(uint256 presetId => Preset preset) private _presets;

    event GlobalFeeCapUpdated(uint16 previousCapBps, uint16 capBps);
    event QuoteTokenStatusUpdated(address indexed quoteToken, bool allowed);
    event GraduationDestinationStatusUpdated(
        GraduationDestination indexed destination, bool supported
    );
    event LaunchpadPresetCreated(
        uint256 indexed presetId,
        bytes32 indexed familyId,
        uint32 indexed version,
        bytes32 configHash
    );
    event LaunchpadPresetStatusUpdated(uint256 indexed presetId, bool enabled);
    event LaunchpadPresetUsed(uint256 indexed presetId);

    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address upgrader, address configAdmin) external initializer {
        if (configAdmin == address(0)) revert InvalidAccount();
        __ProtocolAccess_init(admin, upgrader);
        _setRole(CONFIG_ADMIN_ROLE, configAdmin, true);
        globalMaximumTotalTradeFeeBps = HARD_MAX_TOTAL_TRADE_FEE_BPS;
        destinationSupported[GraduationDestination.DAMM] = true;
        emit GlobalFeeCapUpdated(0, HARD_MAX_TOTAL_TRADE_FEE_BPS);
        emit GraduationDestinationStatusUpdated(GraduationDestination.DAMM, true);
    }

    function setGlobalMaximumTotalTradeFeeBps(uint16 capBps)
        external
        onlyRole(CONFIG_ADMIN_ROLE)
    {
        if (capBps > HARD_MAX_TOTAL_TRADE_FEE_BPS) revert InvalidFeeCap();
        uint16 previous = globalMaximumTotalTradeFeeBps;
        globalMaximumTotalTradeFeeBps = capBps;
        emit GlobalFeeCapUpdated(previous, capBps);
    }

    function setQuoteToken(address quoteToken, bool allowed)
        external
        onlyRole(CONFIG_ADMIN_ROLE)
    {
        if (quoteToken == address(0) || quoteToken.code.length == 0) {
            revert QuoteTokenUnavailable();
        }
        quoteTokenAllowed[quoteToken] = allowed;
        emit QuoteTokenStatusUpdated(quoteToken, allowed);
    }

    function setGraduationDestination(GraduationDestination destination, bool supported)
        external
        onlyRole(CONFIG_ADMIN_ROLE)
    {
        if (destination == GraduationDestination.NONE) revert DestinationUnavailable();
        destinationSupported[destination] = supported;
        emit GraduationDestinationStatusUpdated(destination, supported);
    }

    function createPreset(PresetInput calldata input)
        external
        onlyRole(CONFIG_ADMIN_ROLE)
        returns (uint256 presetId)
    {
        _validate(input);
        uint32 version = latestVersion[input.familyId] + 1;
        latestVersion[input.familyId] = version;
        presetId = ++presetCount;
        bytes32 configHash = keccak256(abi.encode(input));
        _presets[presetId] = Preset({
            familyId: input.familyId,
            configHash: configHash,
            dbcTemplateId: input.dbcTemplateId,
            quoteToken: input.quoteToken,
            maximumTotalTradeFeeBps: input.maximumTotalTradeFeeBps,
            graduationDestination: input.graduationDestination,
            creatorAccess: input.creatorAccess,
            maximumLaunches: input.maximumLaunches,
            version: version,
            enabled: true,
            used: false
        });
        emit LaunchpadPresetCreated(presetId, input.familyId, version, configHash);
        emit LaunchpadPresetStatusUpdated(presetId, true);
    }

    function setPresetEnabled(uint256 presetId, bool enabled)
        external
        onlyRole(CONFIG_ADMIN_ROLE)
    {
        Preset storage item = _preset(presetId);
        item.enabled = enabled;
        emit LaunchpadPresetStatusUpdated(presetId, enabled);
    }

    function markPresetUsed(uint256 presetId) external onlyRole(FACTORY_ROLE) {
        Preset storage item = _preset(presetId);
        if (!item.enabled) revert InvalidPreset();
        if (!item.used) {
            item.used = true;
            emit LaunchpadPresetUsed(presetId);
        }
    }

    function preset(uint256 presetId) external view returns (Preset memory) {
        return _preset(presetId);
    }

    function presets(uint256[] calldata presetIds)
        external
        view
        returns (Preset[] memory items)
    {
        items = new Preset[](presetIds.length);
        for (uint256 index; index < presetIds.length; ++index) {
            items[index] = _preset(presetIds[index]);
        }
    }

    function isEnabled(uint256 presetId) external view returns (bool) {
        return _preset(presetId).enabled;
    }

    function _validate(PresetInput calldata input) private view {
        if (
            input.familyId == bytes32(0) || input.dbcTemplateId == 0
                || input.maximumLaunches == 0
        ) revert InvalidPreset();
        if (!quoteTokenAllowed[input.quoteToken]) revert QuoteTokenUnavailable();
        if (!destinationSupported[input.graduationDestination]) {
            revert DestinationUnavailable();
        }
        if (input.maximumTotalTradeFeeBps > globalMaximumTotalTradeFeeBps) {
            revert InvalidFeeCap();
        }
    }

    function _preset(uint256 presetId) private view returns (Preset storage item) {
        item = _presets[presetId];
        if (item.version == 0) revert PresetNotFound();
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

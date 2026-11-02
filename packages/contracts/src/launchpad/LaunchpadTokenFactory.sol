// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { DbcTypes } from "../dbc/DbcTypes.sol";
import { LaunchConfigRegistry } from "../dbc/LaunchConfigRegistry.sol";
import { LaunchFactory } from "../dbc/LaunchFactory.sol";
import { VirtualPool } from "../dbc/VirtualPool.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { ILaunchpadRegistry } from "./ILaunchpadRegistry.sol";
import { LaunchpadConfigManager } from "./LaunchpadConfigManager.sol";
import { LaunchpadFeeController } from "./LaunchpadFeeController.sol";
import { LaunchpadFeeCollector } from "./LaunchpadFeeCollector.sol";
import { LaunchpadTypes } from "./LaunchpadTypes.sol";
import { RevenueSplitter } from "./RevenueSplitter.sol";

/// @notice Versioned DBC launch entry point that atomically binds immutable launchpad economics.
contract LaunchpadTokenFactory is ProtocolAccess, UUPSUpgradeable {
    error InvalidLaunchRequest();
    error UnauthorizedLaunchpadCaller();
    error LaunchCapacityExceeded();
    error IncompatibleConfiguration();
    error LaunchAlreadyBound();

    uint16 public constant BINDING_SCHEMA_VERSION = 1;

    struct LaunchpadLaunchRequest {
        uint256 launchpadId;
        LaunchFactory.LaunchRequest dbc;
        address referralRecipient;
    }

    struct LaunchBinding {
        uint256 launchpadId;
        uint256 configPresetId;
        bytes32 configHash;
        bytes32 feeSnapshotId;
        address creator;
        address treasury;
        address token;
        address virtualPool;
        LaunchpadConfigManager.GraduationDestination graduationDestination;
    }

    ILaunchpadRegistry public registry;
    LaunchpadConfigManager public configManager;
    LaunchFactory public dbcFactory;
    LaunchpadFeeController public feeController;
    RevenueSplitter public revenueSplitter;
    LaunchpadFeeCollector public feeCollector;
    mapping(uint256 launchpadId => uint256 count) public launchCountByLaunchpad;
    mapping(bytes32 launchId => LaunchBinding binding) private _bindings;
    mapping(address token => bytes32 launchId) public launchByToken;
    mapping(address pool => bytes32 launchId) public launchByPool;

    event LaunchpadTokenBound(
        bytes32 indexed launchId,
        uint256 indexed launchpadId,
        bytes32 indexed feeSnapshotId,
        uint16 bindingSchemaVersion,
        address creator,
        address treasury,
        address token,
        address virtualPool,
        uint256 configPresetId,
        bytes32 configHash,
        LaunchpadConfigManager.GraduationDestination graduationDestination
    );

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        address upgrader,
        ILaunchpadRegistry registry_,
        LaunchpadConfigManager configManager_,
        LaunchFactory dbcFactory_,
        LaunchpadFeeController feeController_,
        RevenueSplitter revenueSplitter_,
        LaunchpadFeeCollector feeCollector_
    ) external initializer {
        if (
            address(registry_) == address(0) || address(configManager_) == address(0)
                || address(dbcFactory_) == address(0) || address(feeController_) == address(0)
                || address(revenueSplitter_) == address(0)
                || address(feeCollector_) == address(0)
        ) revert InvalidLaunchRequest();
        __ProtocolAccess_init(admin, upgrader);
        registry = registry_;
        configManager = configManager_;
        dbcFactory = dbcFactory_;
        feeController = feeController_;
        revenueSplitter = revenueSplitter_;
        feeCollector = feeCollector_;
    }

    function createLaunch(LaunchpadLaunchRequest calldata request)
        external
        returns (bytes32 launchId, address token, address virtualPool, bytes32 feeSnapshotId)
    {
        LaunchpadTypes.Record memory launchpad = registry.launchpad(request.launchpadId);
        if (launchpad.status != LaunchpadTypes.Status.ACTIVE) {
            revert UnauthorizedLaunchpadCaller();
        }
        LaunchpadConfigManager.Preset memory preset =
            configManager.preset(launchpad.configPresetId);
        if (
            preset.creatorAccess == LaunchpadConfigManager.CreatorAccess.OWNER_OR_OPERATOR
                && msg.sender != launchpad.owner && msg.sender != launchpad.operator
        ) revert UnauthorizedLaunchpadCaller();
        uint256 nextCount = launchCountByLaunchpad[request.launchpadId] + 1;
        if (!preset.enabled || nextCount > preset.maximumLaunches) {
            revert LaunchCapacityExceeded();
        }
        _validateCompatibility(request.dbc.templateId, preset, request.launchpadId);

        (launchId, token, virtualPool) =
            dbcFactory.createLaunchFor(request.dbc, msg.sender, address(feeCollector));
        if (
            _bindings[launchId].creator != address(0) || launchByToken[token] != bytes32(0)
                || launchByPool[virtualPool] != bytes32(0)
        ) revert LaunchAlreadyBound();
        feeSnapshotId = feeController.snapshotPolicy(
            request.launchpadId,
            virtualPool,
            launchpad.treasury,
            request.referralRecipient
        );
        revenueSplitter.registerSnapshot(
            feeSnapshotId,
            feeController.snapshot(feeSnapshotId),
            VirtualPool(virtualPool).quoteToken()
        );
        feeCollector.registerPool(
            virtualPool, feeSnapshotId, VirtualPool(virtualPool).quoteToken()
        );

        _bindings[launchId] = LaunchBinding({
            launchpadId: request.launchpadId,
            configPresetId: launchpad.configPresetId,
            configHash: preset.configHash,
            feeSnapshotId: feeSnapshotId,
            creator: msg.sender,
            treasury: launchpad.treasury,
            token: token,
            virtualPool: virtualPool,
            graduationDestination: preset.graduationDestination
        });
        launchByToken[token] = launchId;
        launchByPool[virtualPool] = launchId;
        launchCountByLaunchpad[request.launchpadId] = nextCount;
        emit LaunchpadTokenBound(
            launchId,
            request.launchpadId,
            feeSnapshotId,
            BINDING_SCHEMA_VERSION,
            msg.sender,
            launchpad.treasury,
            token,
            virtualPool,
            launchpad.configPresetId,
            preset.configHash,
            preset.graduationDestination
        );
    }

    function binding(bytes32 launchId) external view returns (LaunchBinding memory item) {
        item = _bindings[launchId];
        if (item.creator == address(0)) revert InvalidLaunchRequest();
    }

    function _validateCompatibility(
        uint256 templateId,
        LaunchpadConfigManager.Preset memory preset,
        uint256 launchpadId
    ) private view {
        if (templateId != preset.dbcTemplateId) revert IncompatibleConfiguration();
        LaunchConfigRegistry.TemplateRecord memory template =
            dbcFactory.registry().template(templateId);
        LaunchpadFeeController.FeePolicy memory feePolicy = feeController.policy(launchpadId);
        DbcTypes.MigrationMode expectedMigration =
            preset.graduationDestination == LaunchpadConfigManager.GraduationDestination.DAMM
                ? DbcTypes.MigrationMode.DAMM
                : DbcTypes.MigrationMode.DLMM;
        if (
            !template.enabled || template.config.quoteToken != preset.quoteToken
                || template.config.migrationMode != expectedMigration
                || template.config.fees.tradeFeeBps > preset.maximumTotalTradeFeeBps
                || feePolicy.totalTradeFeeBps != template.config.fees.tradeFeeBps
        ) revert IncompatibleConfiguration();
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

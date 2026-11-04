// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

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
import { ProtectedLaunchFactory } from "./protection/ProtectedLaunchFactory.sol";
import { ProtectedVirtualPool } from "../dbc/ProtectedVirtualPool.sol";

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

    struct LaunchpadContext {
        LaunchpadTypes.Record launchpad;
        LaunchpadConfigManager.Preset preset;
        uint256 nextCount;
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
    // Appended for storage compatibility with the deployed UUPS proxy.
    ProtectedLaunchFactory public protectedFactory;

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
    event ProtectedFactoryConfigured(address indexed protectedFactory);

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
        LaunchpadContext memory context =
            _launchpadContext(request.launchpadId, request.dbc.templateId);

        (launchId, token, virtualPool) =
            dbcFactory.createLaunchFor(request.dbc, msg.sender, address(feeCollector));
        feeSnapshotId = _bindLaunch(
            launchId,
            token,
            virtualPool,
            request.launchpadId,
            request.referralRecipient,
            context
        );
    }

    /// @notice Creates a Protected token while preserving launchpad attribution and fee policy.
    function createProtectedLaunch(
        uint256 launchpadId,
        bytes calldata protectedFactoryCall,
        address referralRecipient
    )
        external
        returns (bytes32 launchId, address token, address virtualPool, bytes32 feeSnapshotId)
    {
        if (address(protectedFactory) == address(0)) revert IncompatibleConfiguration();
        bytes4 selector;
        if (protectedFactoryCall.length < 4) revert InvalidLaunchRequest();
        assembly ("memory-safe") {
            selector := calldataload(protectedFactoryCall.offset)
        }
        if (selector != ProtectedLaunchFactory.createLaunchFor.selector) {
            revert InvalidLaunchRequest();
        }
        (bool success, bytes memory result) =
            address(protectedFactory).call(protectedFactoryCall);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }
        (launchId, token, virtualPool) = abi.decode(result, (bytes32, address, address));
        (address creator,,, uint256 templateId,,,) = protectedFactory.launches(launchId);
        if (
            creator != msg.sender
                || ProtectedVirtualPool(virtualPool).feeCollector() != address(feeCollector)
        ) revert InvalidLaunchRequest();
        LaunchpadContext memory context = _launchpadContext(launchpadId, templateId);
        protectedFactory.identityRegistry().bindLaunchpad(launchId, launchpadId);
        feeSnapshotId = _bindLaunch(
            launchId,
            token,
            virtualPool,
            launchpadId,
            referralRecipient,
            context
        );
    }

    function _launchpadContext(uint256 launchpadId, uint256 templateId)
        private
        view
        returns (LaunchpadContext memory context)
    {
        context.launchpad = registry.launchpad(launchpadId);
        if (context.launchpad.status != LaunchpadTypes.Status.ACTIVE) {
            revert UnauthorizedLaunchpadCaller();
        }
        context.preset = configManager.preset(context.launchpad.configPresetId);
        if (
            context.preset.creatorAccess
                == LaunchpadConfigManager.CreatorAccess.OWNER_OR_OPERATOR
                && msg.sender != context.launchpad.owner
                && msg.sender != context.launchpad.operator
        ) revert UnauthorizedLaunchpadCaller();
        context.nextCount = launchCountByLaunchpad[launchpadId] + 1;
        if (!context.preset.enabled || context.nextCount > context.preset.maximumLaunches) {
            revert LaunchCapacityExceeded();
        }
        _validateCompatibility(templateId, context.preset, launchpadId);
    }

    function _bindLaunch(
        bytes32 launchId,
        address token,
        address virtualPool,
        uint256 launchpadId,
        address referralRecipient,
        LaunchpadContext memory context
    ) private returns (bytes32 feeSnapshotId) {
        if (
            _bindings[launchId].creator != address(0) || launchByToken[token] != bytes32(0)
                || launchByPool[virtualPool] != bytes32(0)
        ) revert LaunchAlreadyBound();
        feeSnapshotId = feeController.snapshotPolicy(
            launchpadId,
            virtualPool,
            context.launchpad.treasury,
            referralRecipient
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
            launchpadId: launchpadId,
            configPresetId: context.launchpad.configPresetId,
            configHash: context.preset.configHash,
            feeSnapshotId: feeSnapshotId,
            creator: msg.sender,
            treasury: context.launchpad.treasury,
            token: token,
            virtualPool: virtualPool,
            graduationDestination: context.preset.graduationDestination
        });
        launchByToken[token] = launchId;
        launchByPool[virtualPool] = launchId;
        launchCountByLaunchpad[launchpadId] = context.nextCount;
        emit LaunchpadTokenBound(
            launchId,
            launchpadId,
            feeSnapshotId,
            BINDING_SCHEMA_VERSION,
            msg.sender,
            context.launchpad.treasury,
            token,
            virtualPool,
            context.launchpad.configPresetId,
            context.preset.configHash,
            context.preset.graduationDestination
        );
    }

    function setProtectedFactory(ProtectedLaunchFactory protectedFactory_)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (address(protectedFactory_).code.length == 0) revert InvalidLaunchRequest();
        protectedFactory = protectedFactory_;
        emit ProtectedFactoryConfigured(address(protectedFactory_));
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

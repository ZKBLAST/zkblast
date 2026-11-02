// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { LaunchpadConfigManager } from "./LaunchpadConfigManager.sol";
import { ILaunchpadRegistry } from "./ILaunchpadRegistry.sol";

contract LaunchpadFactory is ProtocolAccess, UUPSUpgradeable {
    error InvalidLaunchpadRequest();
    error PresetUnavailable();

    ILaunchpadRegistry public registry;
    LaunchpadConfigManager public configManager;

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        address upgrader,
        ILaunchpadRegistry registry_,
        LaunchpadConfigManager configManager_
    ) external initializer {
        if (address(registry_) == address(0) || address(configManager_) == address(0)) {
            revert InvalidLaunchpadRequest();
        }
        __ProtocolAccess_init(admin, upgrader);
        registry = registry_;
        configManager = configManager_;
    }

    function createLaunchpad(
        address owner,
        address treasury,
        bytes32 metadataHash,
        bytes32 slugCommitment,
        uint256 configPresetId
    ) external returns (uint256 launchpadId) {
        if (owner == address(0) || owner != msg.sender || treasury == address(0)) {
            revert InvalidLaunchpadRequest();
        }
        if (!configManager.isEnabled(configPresetId)) revert PresetUnavailable();
        launchpadId = registry.registerLaunchpad(
            owner, treasury, metadataHash, slugCommitment, configPresetId
        );
        configManager.markPresetUsed(configPresetId);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

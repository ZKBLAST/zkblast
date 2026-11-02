// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { LaunchpadConfigManager } from "./LaunchpadConfigManager.sol";
import { ILaunchpadRegistry } from "./ILaunchpadRegistry.sol";
import { LaunchpadTypes } from "./LaunchpadTypes.sol";

contract LaunchpadLens {
    struct ViewData {
        uint256 launchpadId;
        LaunchpadTypes.Record launchpad;
        LaunchpadConfigManager.Preset preset;
    }

    ILaunchpadRegistry public immutable registry;
    LaunchpadConfigManager public immutable configManager;

    constructor(ILaunchpadRegistry registry_, LaunchpadConfigManager configManager_) {
        registry = registry_;
        configManager = configManager_;
    }

    function getLaunchpad(uint256 launchpadId) external view returns (ViewData memory data) {
        data.launchpadId = launchpadId;
        data.launchpad = registry.launchpad(launchpadId);
        data.preset = configManager.preset(data.launchpad.configPresetId);
    }

    function getLaunchpads(uint256[] calldata launchpadIds)
        external
        view
        returns (ViewData[] memory items)
    {
        LaunchpadTypes.Record[] memory records = registry.launchpads(launchpadIds);
        uint256[] memory presetIds = new uint256[](launchpadIds.length);
        for (uint256 index; index < launchpadIds.length; ++index) {
            presetIds[index] = records[index].configPresetId;
        }
        LaunchpadConfigManager.Preset[] memory presets = configManager.presets(presetIds);
        items = new ViewData[](launchpadIds.length);
        for (uint256 index; index < launchpadIds.length; ++index) {
            items[index] = ViewData({
                launchpadId: launchpadIds[index],
                launchpad: records[index],
                preset: presets[index]
            });
        }
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { LaunchpadConfigManager } from "../src/launchpad/LaunchpadConfigManager.sol";
import { LaunchpadFactory } from "../src/launchpad/LaunchpadFactory.sol";
import { LaunchpadLens } from "../src/launchpad/LaunchpadLens.sol";
import { LaunchpadRegistry } from "../src/launchpad/LaunchpadRegistry.sol";
import { LaunchpadTypes } from "../src/launchpad/LaunchpadTypes.sol";
import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";

contract LaunchpadQuoteToken { }

contract LaunchpadCreator {
    function create(
        LaunchpadFactory factory,
        address treasury,
        bytes32 metadataHash,
        bytes32 slugCommitment,
        uint256 presetId
    ) external returns (uint256) {
        return factory.createLaunchpad(
            address(this), treasury, metadataHash, slugCommitment, presetId
        );
    }

    function createForAnotherOwner(LaunchpadFactory factory, address owner, uint256 presetId)
        external
        returns (bool success)
    {
        (success,) = address(factory).call(
            abi.encodeCall(
                LaunchpadFactory.createLaunchpad,
                (owner, address(this), keccak256("metadata"), keccak256("slug"), presetId)
            )
        );
    }
}

contract LaunchpadFactoryTest {
    LaunchpadRegistry private registry;
    LaunchpadConfigManager private manager;
    LaunchpadFactory private factory;
    LaunchpadLens private lens;
    LaunchpadQuoteToken private quoteToken;
    uint256 private presetId;

    function setUp() public {
        quoteToken = new LaunchpadQuoteToken();
        manager = LaunchpadConfigManager(
            address(
                new ERC1967Proxy(
                    address(new LaunchpadConfigManager()),
                    abi.encodeCall(
                        LaunchpadConfigManager.initialize,
                        (address(this), address(this), address(this))
                    )
                )
            )
        );
        manager.setQuoteToken(address(quoteToken), true);
        presetId = manager.createPreset(_preset(100));

        registry = LaunchpadRegistry(
            address(
                new ERC1967Proxy(
                    address(new LaunchpadRegistry()),
                    abi.encodeCall(
                        LaunchpadRegistry.initialize,
                        (address(this), address(this), address(this))
                    )
                )
            )
        );
        factory = LaunchpadFactory(
            address(
                new ERC1967Proxy(
                    address(new LaunchpadFactory()),
                    abi.encodeCall(
                        LaunchpadFactory.initialize,
                        (address(this), address(this), registry, manager)
                    )
                )
            )
        );
        registry.setRole(registry.FACTORY_ROLE(), address(factory), true);
        manager.setRole(manager.FACTORY_ROLE(), address(factory), true);
        lens = new LaunchpadLens(registry, manager);
    }

    function testAnyWalletCreatesOwnIsolatedLaunchpad() external {
        LaunchpadCreator alpha = new LaunchpadCreator();
        LaunchpadCreator beta = new LaunchpadCreator();
        uint256 first = alpha.create(
            factory, address(alpha), keccak256("alpha metadata"), keccak256("alpha"), presetId
        );
        uint256 second = beta.create(
            factory, address(beta), keccak256("beta metadata"), keccak256("beta"), presetId
        );

        require(registry.launchpad(first).owner == address(alpha), "alpha owner");
        require(registry.launchpad(second).owner == address(beta), "beta owner");
        require(registry.launchpad(first).slugCommitment != registry.launchpad(second).slugCommitment, "slug isolation");
        require(manager.preset(presetId).used, "preset not marked used");
    }

    function testFactoryRejectsCreatingForAnotherOwner() external {
        LaunchpadCreator creator = new LaunchpadCreator();
        require(!creator.createForAnotherOwner(factory, address(this), presetId), "owner spoofing");
    }

    function testDisabledPresetBlocksCreation() external {
        manager.setPresetEnabled(presetId, false);
        LaunchpadCreator creator = new LaunchpadCreator();
        (bool success,) = address(creator).call(
            abi.encodeCall(
                LaunchpadCreator.create,
                (
                    factory,
                    address(creator),
                    keccak256("metadata"),
                    keccak256("disabled"),
                    presetId
                )
            )
        );
        require(!success, "disabled preset accepted");
    }

    function testPresetSafetyCapsAndCapabilities() external {
        (bool excessiveFee,) = address(manager).call(
            abi.encodeCall(LaunchpadConfigManager.createPreset, (_preset(301)))
        );
        require(!excessiveFee, "excessive fee accepted");

        LaunchpadConfigManager.PresetInput memory dlmm = _preset(100);
        dlmm.familyId = keccak256("DLMM");
        dlmm.graduationDestination = LaunchpadConfigManager.GraduationDestination.DLMM;
        (bool unsupportedDlmm,) = address(manager).call(
            abi.encodeCall(LaunchpadConfigManager.createPreset, (dlmm))
        );
        require(!unsupportedDlmm, "unsupported DLMM accepted");
    }

    function testLensReturnsRegistryAndPresetSnapshots() external {
        LaunchpadCreator creator = new LaunchpadCreator();
        uint256 id = creator.create(
            factory,
            address(creator),
            keccak256("metadata"),
            keccak256("lens"),
            presetId
        );
        LaunchpadLens.ViewData memory item = lens.getLaunchpad(id);
        require(item.launchpadId == id, "id");
        require(item.launchpad.status == LaunchpadTypes.Status.ACTIVE, "status");
        require(item.preset.dbcTemplateId == 1, "dbc template");

        uint256[] memory ids = new uint256[](1);
        ids[0] = id;
        LaunchpadLens.ViewData[] memory items = lens.getLaunchpads(ids);
        require(items.length == 1 && items[0].launchpad.owner == address(creator), "batch");
    }

    function _preset(uint16 feeCap)
        private
        view
        returns (LaunchpadConfigManager.PresetInput memory)
    {
        return LaunchpadConfigManager.PresetInput({
            familyId: keccak256("USDG_DAMM"),
            dbcTemplateId: 1,
            quoteToken: address(quoteToken),
            maximumTotalTradeFeeBps: feeCap,
            graduationDestination: LaunchpadConfigManager.GraduationDestination.DAMM,
            creatorAccess: LaunchpadConfigManager.CreatorAccess.OWNER_OR_OPERATOR,
            maximumLaunches: 100
        });
    }
}

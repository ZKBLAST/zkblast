// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { LaunchpadRegistry } from "../src/launchpad/LaunchpadRegistry.sol";
import { LaunchpadTypes } from "../src/launchpad/LaunchpadTypes.sol";
import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";

contract LaunchpadRegistryV2 is LaunchpadRegistry {
    function implementationVersion() external pure returns (uint256) {
        return 2;
    }
}

contract LaunchpadActor {
    function acceptOwner(LaunchpadRegistry registry, uint256 launchpadId) external {
        registry.acceptOwner(launchpadId);
    }

    function acceptTreasury(LaunchpadRegistry registry, uint256 launchpadId) external {
        registry.acceptTreasury(launchpadId);
    }

    function updateMetadata(LaunchpadRegistry registry, uint256 launchpadId, bytes32 metadata)
        external
        returns (bool success)
    {
        (success,) = address(registry).call(
            abi.encodeCall(LaunchpadRegistry.updateMetadata, (launchpadId, metadata))
        );
    }

    function upgrade(LaunchpadRegistry registry, address implementation)
        external
        returns (bool success)
    {
        (success,) = address(registry).call(
            abi.encodeWithSignature("upgradeToAndCall(address,bytes)", implementation, bytes(""))
        );
    }
}

contract LaunchpadRegistryTest {
    LaunchpadRegistry private registry;
    LaunchpadActor private nextOwner;
    LaunchpadActor private nextTreasury;
    LaunchpadActor private outsider;

    function setUp() public {
        LaunchpadRegistry implementation = new LaunchpadRegistry();
        registry = LaunchpadRegistry(
            address(
                new ERC1967Proxy(
                    address(implementation),
                    abi.encodeCall(
                        LaunchpadRegistry.initialize,
                        (address(this), address(this), address(this))
                    )
                )
            )
        );
        nextOwner = new LaunchpadActor();
        nextTreasury = new LaunchpadActor();
        outsider = new LaunchpadActor();
    }

    function testCreatesIsolatedLaunchpadsAndRejectsDuplicateSlug() external {
        uint256 first = _register(keccak256("alpha"));
        uint256 second = _register(keccak256("beta"));
        require(first == 1 && second == 2, "ids");
        require(registry.launchpadBySlug(keccak256("alpha")) == first, "slug lookup");
        require(registry.launchpad(first).owner == address(this), "owner");
        require(registry.launchpad(second).slugCommitment == keccak256("beta"), "isolation");

        (bool success,) = address(registry).call(
            abi.encodeCall(
                registry.registerLaunchpad,
                (
                    address(this),
                    address(this),
                    keccak256("metadata-2"),
                    keccak256("alpha"),
                    uint256(1)
                )
            )
        );
        require(!success, "duplicate slug accepted");
    }

    function testOwnershipAndTreasuryRequireDesignatedAcceptance() external {
        uint256 id = _register(keccak256("ownership"));
        registry.proposeOwner(id, address(nextOwner));
        (bool outsiderAccepted,) = address(outsider).call(
            abi.encodeCall(LaunchpadActor.acceptOwner, (registry, id))
        );
        require(!outsiderAccepted, "outsider owner accepted");
        nextOwner.acceptOwner(registry, id);
        LaunchpadTypes.Record memory afterOwner = registry.launchpad(id);
        require(afterOwner.owner == address(nextOwner), "owner not updated");
        require(afterOwner.pendingOwner == address(0), "pending owner retained");

        (bool oldOwnerCanPropose,) = address(registry).call(
            abi.encodeCall(LaunchpadRegistry.proposeTreasury, (id, address(nextTreasury)))
        );
        require(!oldOwnerCanPropose, "old owner retained authority");
    }

    function testTreasuryAcceptanceAndOperatorIsolation() external {
        uint256 first = _register(keccak256("first"));
        uint256 second = _register(keccak256("second"));
        registry.proposeTreasury(first, address(nextTreasury));
        nextTreasury.acceptTreasury(registry, first);
        require(registry.launchpad(first).treasury == address(nextTreasury), "treasury");

        registry.setOperator(first, address(nextOwner));
        require(
            nextOwner.updateMetadata(registry, first, keccak256("updated")),
            "operator metadata"
        );
        require(
            !nextOwner.updateMetadata(registry, second, keccak256("cross-launchpad")),
            "cross-launchpad mutation"
        );
    }

    function testPauseDisableAndInvalidInputs() external {
        uint256 id = _register(keccak256("status"));
        registry.setCreationPaused(id, true);
        require(
            registry.launchpad(id).status == LaunchpadTypes.Status.PAUSED_CREATION, "pause"
        );
        registry.setCreationPaused(id, false);
        registry.disable(id);
        require(registry.launchpad(id).status == LaunchpadTypes.Status.DISABLED, "disable");
        (bool resumed,) = address(registry).call(
            abi.encodeCall(LaunchpadRegistry.setCreationPaused, (id, false))
        );
        require(!resumed, "disabled launchpad resumed");

        (bool zeroOwner,) = address(registry).call(
            abi.encodeCall(
                registry.registerLaunchpad,
                (
                    address(0),
                    address(this),
                    keccak256("metadata"),
                    keccak256("zero"),
                    uint256(1)
                )
            )
        );
        require(!zeroOwner, "zero owner accepted");
    }

    function testUpgradeAuthorizationPreservesState() external {
        uint256 id = _register(keccak256("upgrade"));
        address proxy = address(registry);
        LaunchpadRegistryV2 next = new LaunchpadRegistryV2();
        require(!outsider.upgrade(registry, address(next)), "unauthorized upgrade");
        registry.upgradeToAndCall(address(next), bytes(""));
        require(address(registry) == proxy, "proxy changed");
        require(LaunchpadRegistryV2(proxy).implementationVersion() == 2, "upgrade missing");
        require(registry.launchpad(id).slugCommitment == keccak256("upgrade"), "state changed");
    }

    function testImplementationCannotBeInitialized() external {
        LaunchpadRegistry implementation = new LaunchpadRegistry();
        (bool success,) = address(implementation).call(
            abi.encodeCall(
                LaunchpadRegistry.initialize,
                (address(this), address(this), address(this))
            )
        );
        require(!success, "implementation initialized");
    }

    function _register(bytes32 slug) private returns (uint256) {
        return registry.registerLaunchpad(
            address(this), address(this), keccak256(abi.encode(slug)), slug, 1
        );
    }
}

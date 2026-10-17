// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { PoolRegistry } from "../src/core/PoolRegistry.sol";
import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";

contract TimelockExecutorHarness {
    function execute(address target, bytes calldata data) external returns (bytes memory result) {
        require(target != address(0), "zero target");
        (bool success, bytes memory returnData) = target.call(data);
        require(success, "timelock execution failed");
        return returnData;
    }
}

contract GovernedPoolRegistryV2 is PoolRegistry {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract GovernanceAcceptanceTest {
    PoolRegistry private registry;
    TimelockExecutorHarness private timelock;
    address private constant FACTORY = address(0xFACADE);

    function setUp() public {
        timelock = new TimelockExecutorHarness();
        PoolRegistry implementation = new PoolRegistry();
        registry = PoolRegistry(
            address(
                new ERC1967Proxy(
                    address(implementation),
                    abi.encodeCall(
                        PoolRegistry.initialize, (address(this), address(timelock), FACTORY)
                    )
                )
            )
        );
    }

    function testOnlyTimelockCanUpgrade() external {
        GovernedPoolRegistryV2 nextImplementation = new GovernedPoolRegistryV2();
        bytes memory upgradeCall = abi.encodeWithSignature(
            "upgradeToAndCall(address,bytes)", address(nextImplementation), bytes("")
        );
        (bool directSuccess,) = address(registry).call(upgradeCall);
        require(!directSuccess, "admin bypassed timelock");

        timelock.execute(address(registry), upgradeCall);
        require(GovernedPoolRegistryV2(address(registry)).version() == 2, "upgrade failed");
    }

    function testRoleBoundariesRemainSeparated() external view {
        require(registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), address(this)), "admin missing");
        require(registry.hasRole(registry.UPGRADER_ROLE(), address(timelock)), "upgrader missing");
        require(registry.hasRole(registry.FACTORY_ROLE(), FACTORY), "factory missing");
        require(!registry.hasRole(registry.UPGRADER_ROLE(), address(this)), "admin is upgrader");
        require(
            !registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), address(timelock)), "timelock is admin"
        );
    }

    function testUpgraderCannotGrantItselfAdmin() external {
        bytes memory callData = abi.encodeWithSignature(
            "setRole(bytes32,address,bool)", registry.DEFAULT_ADMIN_ROLE(), address(timelock), true
        );
        (bool success,) = address(timelock)
            .call(abi.encodeCall(TimelockExecutorHarness.execute, (address(registry), callData)));
        require(!success, "upgrader escalated privileges");
    }
}

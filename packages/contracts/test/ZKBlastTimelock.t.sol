// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ZKBlastTimelock } from "../src/governance/ZKBlastTimelock.sol";

interface Vm {
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function expectRevert() external;
}

contract TimelockTarget {
    uint256 public value;

    function setValue(uint256 nextValue) external {
        value = nextValue;
    }
}

contract ZKBlastTimelockTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant GOVERNANCE = address(0xBEEF);
    uint256 private constant DELAY = 5 minutes;

    ZKBlastTimelock private timelock;
    TimelockTarget private target;

    function setUp() external {
        timelock = new ZKBlastTimelock(DELAY, GOVERNANCE);
        target = new TimelockTarget();
    }

    function testMultisigOwnsOperationalRolesAndNoExternalAdminExists() external view {
        require(timelock.getMinDelay() == DELAY, "delay");
        require(timelock.hasRole(timelock.PROPOSER_ROLE(), GOVERNANCE), "proposer");
        require(timelock.hasRole(timelock.EXECUTOR_ROLE(), GOVERNANCE), "executor");
        require(timelock.hasRole(timelock.CANCELLER_ROLE(), GOVERNANCE), "canceller");
        require(timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), address(timelock)), "self admin");
        require(!timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), GOVERNANCE), "external admin");
    }

    function testOperationCannotExecuteBeforeDelay() external {
        bytes memory payload = abi.encodeCall(TimelockTarget.setValue, (42));
        bytes32 predecessor;
        bytes32 salt = keccak256("ZKBLAST_TIMELOCK_TEST");

        vm.prank(GOVERNANCE);
        timelock.schedule(address(target), 0, payload, predecessor, salt, DELAY);

        vm.prank(GOVERNANCE);
        vm.expectRevert();
        timelock.execute(address(target), 0, payload, predecessor, salt);

        vm.warp(block.timestamp + DELAY);
        vm.prank(GOVERNANCE);
        timelock.execute(address(target), 0, payload, predecessor, salt);
        require(target.value() == 42, "not executed");
    }

    function testRejectsShortDelayAndZeroGovernance() external {
        vm.expectRevert();
        new ZKBlastTimelock(5 minutes - 1, GOVERNANCE);
        vm.expectRevert();
        new ZKBlastTimelock(DELAY, address(0));
    }
}

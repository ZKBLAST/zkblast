// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @notice Mainnet upgrade controller. The governance multisig proposes,
/// cancels, and executes operations only after the configured delay.
contract ZKBlastTimelock is TimelockController {
    uint256 public constant MINIMUM_DELAY = 5 minutes;

    error InvalidGovernance();
    error InvalidDelay();

    constructor(uint256 minimumDelay, address governanceMultisig)
        TimelockController(
            minimumDelay, _singleton(governanceMultisig), _singleton(governanceMultisig), address(0)
        )
    {
        if (governanceMultisig == address(0)) revert InvalidGovernance();
        if (minimumDelay < MINIMUM_DELAY) revert InvalidDelay();
    }

    function _singleton(address account) private pure returns (address[] memory values) {
        values = new address[](1);
        values[0] = account;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DbcTypes } from "./DbcTypes.sol";
import { VirtualPool } from "./VirtualPool.sol";

/// @notice One-time-bound CREATE2 boundary that keeps pool creation bytecode out of the factory.
contract VirtualPoolDeployer {
    error Unauthorized();
    error AlreadyBound();

    address public immutable binder;
    address public factory;

    constructor(address binder_) {
        if (binder_ == address(0)) revert Unauthorized();
        binder = binder_;
    }

    function bindFactory(address factory_) external {
        if (msg.sender != binder || factory_ == address(0)) revert Unauthorized();
        if (factory != address(0)) revert AlreadyBound();
        factory = factory_;
    }

    function deploy(
        bytes32 salt,
        bytes32 launchId,
        uint256 templateId,
        address creator,
        address token,
        DbcTypes.TemplateConfig calldata config
    ) external returns (VirtualPool pool) {
        if (msg.sender != factory) revert Unauthorized();
        pool = new VirtualPool{ salt: salt }(
            launchId, templateId, msg.sender, creator, token, config
        );
    }
}

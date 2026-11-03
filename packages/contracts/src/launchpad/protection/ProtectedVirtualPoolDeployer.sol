// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DbcTypes } from "../../dbc/DbcTypes.sol";
import { ProtectedVirtualPool } from "../../dbc/ProtectedVirtualPool.sol";

/// @notice One-time-bound CREATE2 deployer for the reviewed Protected pool template.
contract ProtectedVirtualPoolDeployer {
    error AlreadyBound();
    error Unauthorized();

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
        DbcTypes.TemplateConfig calldata config,
        address feeCollector,
        bytes32 policyHash,
        uint64 protectionStartBlock,
        uint32 protectionBlocks,
        uint16 initialBuyFeeBps,
        uint16 baseFeeBps
    ) external returns (ProtectedVirtualPool pool) {
        if (msg.sender != factory) revert Unauthorized();
        pool = new ProtectedVirtualPool{ salt: salt }(
            launchId,
            templateId,
            msg.sender,
            creator,
            token,
            config,
            feeCollector,
            policyHash,
            protectionStartBlock,
            protectionBlocks,
            initialBuyFeeBps,
            baseFeeBps
        );
    }
}

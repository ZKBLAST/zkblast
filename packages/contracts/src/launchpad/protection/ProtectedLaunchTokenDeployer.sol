// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtectedLaunchToken } from "./ProtectedLaunchToken.sol";

/// @notice One-time-bound CREATE2 deployer for the reviewed Protected Launch token template.
contract ProtectedLaunchTokenDeployer {
    error AlreadyBound();
    error Unauthorized();

    address public immutable binder;
    address public factory;

    event ProtectedLaunchTokenDeployed(
        address indexed token,
        bytes32 indexed launchId,
        uint256 indexed policyId,
        bytes32 policyHash,
        bytes32 salt
    );

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
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        uint256 totalSupply,
        bytes32 launchId,
        uint256 policyId,
        bytes32 policyHash,
        uint32 protectionBlocks,
        uint16 maxBuyBpsPerTransaction,
        uint16 maxBuyBpsPerAddress
    ) external returns (ProtectedLaunchToken token) {
        if (msg.sender != factory) revert Unauthorized();
        token = new ProtectedLaunchToken{ salt: salt }(
            name,
            symbol,
            metadataURI,
            totalSupply,
            msg.sender,
            msg.sender,
            launchId,
            policyId,
            policyHash,
            protectionBlocks,
            maxBuyBpsPerTransaction,
            maxBuyBpsPerAddress
        );
        emit ProtectedLaunchTokenDeployed(address(token), launchId, policyId, policyHash, salt);
    }
}

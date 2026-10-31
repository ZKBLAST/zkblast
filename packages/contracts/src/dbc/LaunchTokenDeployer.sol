// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { LaunchToken } from "./LaunchToken.sol";

/// @notice One-time-bound CREATE2 boundary that keeps token creation bytecode out of the factory.
contract LaunchTokenDeployer {
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
        string calldata name,
        string calldata symbol,
        string calldata metadataURI,
        uint256 totalSupply,
        address initialHolder
    ) external returns (LaunchToken token) {
        if (msg.sender != factory) revert Unauthorized();
        token = new LaunchToken{ salt: salt }(name, symbol, metadataURI, totalSupply, initialHolder);
    }
}

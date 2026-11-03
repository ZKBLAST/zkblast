// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Clones } from "@openzeppelin/contracts/proxy/Clones.sol";
import { DbcTypes } from "./DbcTypes.sol";
import { HyperEvmVirtualPool } from "./HyperEvmVirtualPool.sol";
import { VirtualPool } from "./VirtualPool.sol";

/// @notice Deterministic minimal-proxy deployer that keeps per-launch gas below HyperEVM limits.
contract HyperEvmVirtualPoolDeployer {
    error Unauthorized();
    error AlreadyBound();

    address public immutable binder;
    address public immutable implementation;
    address public factory;

    constructor(address binder_, address implementation_) {
        if (binder_ == address(0) || implementation_.code.length == 0) revert Unauthorized();
        binder = binder_;
        implementation = implementation_;
    }

    function bindFactory(address factory_) external {
        if (msg.sender != binder || factory_ == address(0)) revert Unauthorized();
        if (factory != address(0)) revert AlreadyBound();
        factory = factory_;
    }

    function deploy(bytes32 salt, bytes32 launchId, uint256 templateId, address creator, address token, DbcTypes.TemplateConfig calldata config) external returns (VirtualPool pool) {
        return _deploy(salt, launchId, templateId, creator, token, config, address(0));
    }

    function deployForLaunchpad(bytes32 salt, bytes32 launchId, uint256 templateId, address creator, address token, DbcTypes.TemplateConfig calldata config, address feeCollector) external returns (VirtualPool pool) {
        if (feeCollector == address(0)) revert Unauthorized();
        return _deploy(salt, launchId, templateId, creator, token, config, feeCollector);
    }

    function predict(bytes32 salt) external view returns (address) {
        return Clones.predictDeterministicAddress(implementation, salt, address(this));
    }

    function _deploy(bytes32 salt, bytes32 launchId, uint256 templateId, address creator, address token, DbcTypes.TemplateConfig calldata config, address feeCollector) private returns (VirtualPool pool) {
        if (msg.sender != factory) revert Unauthorized();
        address clone = Clones.cloneDeterministic(implementation, salt);
        HyperEvmVirtualPool(clone).initialize(launchId, templateId, msg.sender, creator, token, config, feeCollector);
        return VirtualPool(clone);
    }
}

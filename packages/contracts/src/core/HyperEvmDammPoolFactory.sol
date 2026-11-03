// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { PoolKey, PoolKeyLib, PoolModel } from "./PoolTypes.sol";
import { PoolRegistry } from "./PoolRegistry.sol";
import { DammPool } from "./DammPool.sol";

/// @notice Gas-bounded PoolFactory implementation for HyperEVM's 3M block gas limit.
/// @dev It intentionally rejects DLMM. The public ABI used by DAMM adapters remains compatible.
contract HyperEvmDammPoolFactory is ProtocolAccess, UUPSUpgradeable {
    error InvalidConfiguration();
    error PoolAlreadyExists();

    PoolRegistry public registry;

    event PoolCreated(bytes32 indexed poolId, address indexed pool, PoolKey key);

    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address upgrader, PoolRegistry registry_)
        external
        initializer
    {
        if (address(registry_) == address(0)) revert InvalidConfiguration();
        __ProtocolAccess_init(admin, upgrader);
        registry = registry_;
    }

    function permissionlessCreation() external pure returns (bool) {
        return true;
    }

    function createPool(
        address tokenA,
        address tokenB,
        PoolModel model,
        uint24 feePips,
        uint16 binStepBps
    ) external returns (address pool) {
        if (
            model != PoolModel.DAMM || feePips == 0 || feePips >= 1_000_000
                || binStepBps != 0
        ) revert InvalidConfiguration();
        PoolKey memory key = PoolKeyLib.normalize(tokenA, tokenB, model, feePips, 0);
        bytes32 poolId = PoolKeyLib.id(key);
        if (registry.poolById(poolId) != address(0)) revert PoolAlreadyExists();
        pool = address(new DammPool{ salt: poolId }(key, msg.sender));
        registry.registerPool(poolId, pool, key);
        emit PoolCreated(poolId, pool, key);
    }

    function predictPoolAddress(PoolKey calldata key, address administrator)
        external
        view
        returns (address predicted)
    {
        if (key.model != PoolModel.DAMM || key.binStepBps != 0) {
            revert InvalidConfiguration();
        }
        bytes32 salt = PoolKeyLib.id(key);
        bytes32 initCodeHash =
            keccak256(abi.encodePacked(type(DammPool).creationCode, abi.encode(key, administrator)));
        predicted = address(
            uint160(
                uint256(
                    keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash))
                )
            )
        );
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

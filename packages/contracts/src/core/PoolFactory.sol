// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { PoolKey, PoolKeyLib, PoolModel } from "./PoolTypes.sol";
import { PoolRegistry } from "./PoolRegistry.sol";
import { DammPool } from "./DammPool.sol";
import { DlmmPool } from "./DlmmPool.sol";

contract PoolFactory is ProtocolAccess, UUPSUpgradeable {
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

    function createPool(
        address tokenA,
        address tokenB,
        PoolModel model,
        uint24 feePips,
        uint16 binStepBps
    ) external onlyRole(DEFAULT_ADMIN_ROLE) returns (address pool) {
        if (feePips == 0 || feePips >= 1_000_000) revert InvalidConfiguration();
        if (model == PoolModel.DAMM && binStepBps != 0) revert InvalidConfiguration();
        if (model == PoolModel.DLMM && (binStepBps == 0 || binStepBps > 1_000)) {
            revert InvalidConfiguration();
        }
        PoolKey memory key = PoolKeyLib.normalize(tokenA, tokenB, model, feePips, binStepBps);
        bytes32 poolId = PoolKeyLib.id(key);
        if (registry.poolById(poolId) != address(0)) revert PoolAlreadyExists();
        pool = model == PoolModel.DAMM
            ? address(new DammPool{ salt: poolId }(key, msg.sender))
            : address(new DlmmPool{ salt: poolId }(key, msg.sender, 0));
        registry.registerPool(poolId, pool, key);
        emit PoolCreated(poolId, pool, key);
    }

    function predictPoolAddress(PoolKey calldata key, address administrator)
        external
        view
        returns (address predicted)
    {
        bytes32 salt = PoolKeyLib.id(key);
        bytes32 initCodeHash = key.model == PoolModel.DAMM
            ? keccak256(
                abi.encodePacked(type(DammPool).creationCode, abi.encode(key, administrator))
            )
            : keccak256(
                abi.encodePacked(
                    type(DlmmPool).creationCode, abi.encode(key, administrator, int24(0))
                )
            );
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

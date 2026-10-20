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
    event DlmmPoolInitialized(address indexed pool, int24 initialActiveBin);

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

    /// @notice Creation is public; governance and upgrade roles remain restricted.
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
        if (feePips == 0 || feePips >= 1_000_000) revert InvalidConfiguration();
        if (model == PoolModel.DAMM && binStepBps != 0) revert InvalidConfiguration();
        if (model == PoolModel.DLMM && (binStepBps == 0 || binStepBps > 1_000)) {
            revert InvalidConfiguration();
        }
        PoolKey memory key = PoolKeyLib.normalize(tokenA, tokenB, model, feePips, binStepBps);
        pool = _createPool(key, 0);
    }

    function createDlmmPool(
        address tokenA,
        address tokenB,
        uint24 feePips,
        uint16 binStepBps,
        int24 initialActiveBin
    ) external returns (address pool) {
        if (feePips == 0 || feePips >= 1_000_000) {
            revert InvalidConfiguration();
        }
        if (binStepBps == 0 || binStepBps > 1_000) revert InvalidConfiguration();
        PoolKey memory key =
            PoolKeyLib.normalize(tokenA, tokenB, PoolModel.DLMM, feePips, binStepBps);
        pool = _createPool(key, initialActiveBin);
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

    function predictDlmmPoolAddress(
        PoolKey calldata key,
        address administrator,
        int24 initialActiveBin
    ) external view returns (address predicted) {
        if (key.model != PoolModel.DLMM || key.binStepBps == 0 || key.binStepBps > 1_000) {
            revert InvalidConfiguration();
        }
        bytes32 salt = PoolKeyLib.id(key);
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(DlmmPool).creationCode, abi.encode(key, administrator, initialActiveBin)
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

    function _createPool(PoolKey memory key, int24 initialActiveBin)
        private
        returns (address pool)
    {
        bytes32 poolId = PoolKeyLib.id(key);
        if (registry.poolById(poolId) != address(0)) revert PoolAlreadyExists();
        pool = key.model == PoolModel.DAMM
            ? address(new DammPool{ salt: poolId }(key, msg.sender))
            : address(new DlmmPool{ salt: poolId }(key, msg.sender, initialActiveBin));
        registry.registerPool(poolId, pool, key);
        emit PoolCreated(poolId, pool, key);
        if (key.model == PoolModel.DLMM) emit DlmmPoolInitialized(pool, initialActiveBin);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

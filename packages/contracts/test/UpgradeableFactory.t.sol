// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { PoolFactory } from "../src/core/PoolFactory.sol";
import { PoolRegistry } from "../src/core/PoolRegistry.sol";
import { PoolKey, PoolKeyLib, PoolModel } from "../src/core/PoolTypes.sol";
import { DammPool } from "../src/core/DammPool.sol";
import { DlmmPool } from "../src/core/DlmmPool.sol";
import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";

contract PoolRegistryV2 is PoolRegistry {
    function version() external pure returns (uint256) {
        return 2;
    }
}

contract UnauthorizedCaller {
    function upgrade(address proxy, address implementation) external returns (bool success) {
        require(proxy != address(0), "zero proxy");
        (success,) = proxy.call(
            abi.encodeWithSignature("upgradeToAndCall(address,bytes)", implementation, bytes(""))
        );
    }
}

contract UpgradeableFactoryTest {
    PoolRegistry private registry;
    PoolFactory private factory;
    address private constant TOKEN_A = address(0xA11CE);
    address private constant TOKEN_B = address(0xB0B);

    function setUp() public {
        PoolRegistry registryImplementation = new PoolRegistry();
        registry = PoolRegistry(
            address(
                new ERC1967Proxy(
                    address(registryImplementation),
                    abi.encodeCall(
                        PoolRegistry.initialize, (address(this), address(this), address(this))
                    )
                )
            )
        );

        PoolFactory factoryImplementation = new PoolFactory();
        factory = PoolFactory(
            address(
                new ERC1967Proxy(
                    address(factoryImplementation),
                    abi.encodeCall(PoolFactory.initialize, (address(this), address(this), registry))
                )
            )
        );
        registry.setRole(registry.FACTORY_ROLE(), address(factory), true);
    }

    function testImplementationInitializersAreDisabled() external {
        PoolRegistry implementation = new PoolRegistry();
        (bool success,) = address(implementation)
            .call(
                abi.encodeCall(
                    PoolRegistry.initialize, (address(this), address(this), address(this))
                )
            );
        require(!success, "implementation initialized");
    }

    function testCreatesDeterministicNormalizedDammPool() external {
        PoolKey memory key = PoolKeyLib.normalize(TOKEN_A, TOKEN_B, PoolModel.DAMM, 3_000, 0);
        address predicted = factory.predictPoolAddress(key, address(this));
        address pool = factory.createPool(TOKEN_B, TOKEN_A, PoolModel.DAMM, 3_000, 0);
        bytes32 poolId = PoolKeyLib.id(key);

        require(pool == predicted, "create2 prediction");
        require(registry.poolById(poolId) == pool, "registry lookup");
        require(registry.idByPool(pool) == poolId, "reverse lookup");
        require(registry.poolCount() == 1, "pool count");
        require(DammPool(pool).token0() == key.token0, "token0");
        require(DammPool(pool).token1() == key.token1, "token1");
    }

    function testCreatesDlmmPoolWithBinStep() external {
        PoolKey memory key = PoolKeyLib.normalize(TOKEN_A, TOKEN_B, PoolModel.DLMM, 1_000, 25);
        address predicted = factory.predictPoolAddress(key, address(this));
        address pool = factory.createPool(TOKEN_A, TOKEN_B, PoolModel.DLMM, 1_000, 25);
        require(pool == predicted, "create2 prediction");
        require(DlmmPool(pool).model() == PoolModel.DLMM, "model");
        require(DlmmPool(pool).binStepBps() == 25, "bin step");
    }

    function testCreatesDlmmPoolAtExplicitInitialBin() external {
        int24 initialActiveBin = -7_740;
        PoolKey memory key = PoolKeyLib.normalize(TOKEN_A, TOKEN_B, PoolModel.DLMM, 1_000, 25);
        address predicted = factory.predictDlmmPoolAddress(key, address(this), initialActiveBin);
        address pool = factory.createDlmmPool(TOKEN_B, TOKEN_A, 1_000, 25, initialActiveBin);

        require(pool == predicted, "explicit create2 prediction");
        require(DlmmPool(pool).activeBin() == initialActiveBin, "initial active bin");
        require(DlmmPool(pool).token0() == key.token0, "normalized token0");
        require(DlmmPool(pool).token1() == key.token1, "normalized token1");
    }

    function testRejectsDuplicateDlmmAcrossCreationPaths() external {
        factory.createDlmmPool(TOKEN_A, TOKEN_B, 1_000, 25, -100);
        (bool success,) = address(factory)
            .call(
                abi.encodeCall(
                    PoolFactory.createPool,
                    (TOKEN_A, TOKEN_B, PoolModel.DLMM, uint24(1_000), uint16(25))
                )
            );
        require(!success, "duplicate DLMM accepted");
    }

    function testRejectsDuplicatePool() external {
        factory.createPool(TOKEN_A, TOKEN_B, PoolModel.DAMM, 3_000, 0);
        (bool success,) = address(factory)
            .call(
                abi.encodeCall(
                    PoolFactory.createPool,
                    (TOKEN_B, TOKEN_A, PoolModel.DAMM, uint24(3_000), uint16(0))
                )
            );
        require(!success, "duplicate accepted");
    }

    function testAuthorizedUpgradePreservesProxyAndState() external {
        address proxyAddress = address(registry);
        PoolRegistryV2 nextImplementation = new PoolRegistryV2();
        registry.upgradeToAndCall(address(nextImplementation), bytes(""));

        require(address(registry) == proxyAddress, "proxy changed");
        require(PoolRegistryV2(proxyAddress).version() == 2, "upgrade missing");
        require(registry.poolCount() == 0, "state changed");
    }

    function testUnauthorizedUpgradeIsRejected() external {
        UnauthorizedCaller caller = new UnauthorizedCaller();
        PoolRegistryV2 nextImplementation = new PoolRegistryV2();
        require(!caller.upgrade(address(registry), address(nextImplementation)), "upgrade allowed");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DammPool } from "../src/core/DammPool.sol";
import { PoolRegistry } from "../src/core/PoolRegistry.sol";
import { PoolKey, PoolKeyLib, PoolModel } from "../src/core/PoolTypes.sol";
import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";
import { Poseidon2FieldHasher } from "../src/privacy/Poseidon2FieldHasher.sol";
import { ShieldedLPManager } from "../src/privacy/ShieldedLPManager.sol";
import { ShieldedStateRegistry } from "../src/privacy/ShieldedStateRegistry.sol";
import { ZKBlastVault } from "../src/privacy/ZKBlastVault.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";

contract ShieldedLPManagerTest {
    uint256 private constant DEADLINE = type(uint256).max;
    uint128 private constant AMOUNT0 = 100 ether;
    uint128 private constant AMOUNT1 = 200 ether;

    MockERC20 private token0;
    MockERC20 private token1;
    DammPool private pool;
    ZKBlastVault private vault;
    ShieldedLPManager private manager;

    function setUp() public {
        MockERC20 tokenA = new MockERC20("Token A", "TKA");
        MockERC20 tokenB = new MockERC20("Token B", "TKB");
        PoolKey memory key =
            PoolKeyLib.normalize(address(tokenA), address(tokenB), PoolModel.DAMM, 3_000, 0);
        token0 = MockERC20(key.token0);
        token1 = MockERC20(key.token1);
        pool = new DammPool(key, address(this));
        PoolRegistry poolRegistry = PoolRegistry(
            address(
                new ERC1967Proxy(
                    address(new PoolRegistry()),
                    abi.encodeCall(
                        PoolRegistry.initialize, (address(this), address(this), address(this))
                    )
                )
            )
        );
        poolRegistry.registerPool(PoolKeyLib.id(key), address(pool), key);
        ShieldedStateRegistry stateRegistry = ShieldedStateRegistry(
            address(
                new ERC1967Proxy(
                    address(new ShieldedStateRegistry()),
                    abi.encodeCall(ShieldedStateRegistry.initialize, (address(this), address(this)))
                )
            )
        );
        vault = ZKBlastVault(
            address(
                new ERC1967Proxy(
                    address(new ZKBlastVault()),
                    abi.encodeCall(
                        ZKBlastVault.initialize,
                        (
                            address(this),
                            address(this),
                            stateRegistry,
                            new Poseidon2FieldHasher(),
                            bytes32(uint256(1)),
                            uint64(1)
                        )
                    )
                )
            )
        );
        stateRegistry.setVaultAuthorization(address(vault), true);
        vault.setAssetConfig(address(token0), AMOUNT0, true);
        vault.setAssetConfig(address(token1), AMOUNT1, true);
        manager = new ShieldedLPManager(address(this), address(vault), poolRegistry, pool);
        vault.setLPManager(manager, true);
        token0.mint(address(this), 2_000 ether);
        token1.mint(address(this), 4_000 ether);
        token0.approve(address(pool), 1_000 ether);
        token1.approve(address(pool), 2_000 ether);
        pool.addLiquidity(1_000 ether, 2_000 ether, 1, address(this), DEADLINE);
        token0.approve(address(vault), AMOUNT0);
        vault.deposit(address(token0), AMOUNT0, bytes32(uint256(11)));
        token1.approve(address(vault), AMOUNT1);
        vault.deposit(address(token1), AMOUNT1, bytes32(uint256(12)));
        // Governance-funded reserve absorbs AMM share rounding and is not a user liability.
        token0.transfer(address(vault), 1 ether);
        token1.transfer(address(vault), 1 ether);
    }

    function testMultiAssetInvestmentConservesAssetsAndLiabilities() external {
        uint256 shares = vault.investAggregateLiquidity(manager, 50 ether, 100 ether, 1, DEADLINE);
        require(shares > 0 && manager.managedShares() == shares, "shares missing");
        _requireSolvent(address(token0), AMOUNT0);
        _requireSolvent(address(token1), AMOUNT1);

        (uint256 preview0, uint256 preview1) = manager.previewAssets();
        require(preview0 <= 50 ether && preview1 <= 100 ether, "rounding increased assets");
        require(token0.balanceOf(address(vault)) == 51 ether, "wrong liquid token0");
        require(token1.balanceOf(address(vault)) == 101 ether, "wrong liquid token1");
    }

    function testMultipleDepositsIncreaseLiabilitiesWithoutMintingPublicUserShares() external {
        token0.approve(address(vault), AMOUNT0);
        vault.deposit(address(token0), AMOUNT0, bytes32(uint256(21)));
        token1.approve(address(vault), AMOUNT1);
        vault.deposit(address(token1), AMOUNT1, bytes32(uint256(22)));

        vault.investAggregateLiquidity(manager, 100 ether, 200 ether, 1, DEADLINE);
        _requireSolvent(address(token0), uint256(AMOUNT0) * 2);
        _requireSolvent(address(token1), uint256(AMOUNT1) * 2);
        require(manager.managedShares() > 0, "aggregate shares missing");
    }

    function testYieldLossAndProportionalRedemptionRemainConservative() external {
        uint256 shares = vault.investAggregateLiquidity(manager, 50 ether, 100 ether, 1, DEADLINE);
        token0.mint(address(this), 10 ether);
        token0.approve(address(pool), 10 ether);
        pool.swapExactInput(address(token0), 10 ether, 1, address(this), DEADLINE);
        (uint256 afterSwap0, uint256 afterSwap1) = manager.previewAssets();
        require(afterSwap0 > 50 ether && afterSwap1 < 100 ether, "yield/loss not reflected");

        uint256 half = shares / 2;
        (uint256 amount0, uint256 amount1) =
            vault.divestAggregateLiquidity(manager, half, 1, 1, DEADLINE);
        require(amount0 > 0 && amount1 > 0, "redemption missing");
        require(manager.managedShares() == shares - half, "wrong remaining shares");
        require(token0.balanceOf(address(vault)) >= 51 ether + amount0, "token0 not returned");
        require(token1.balanceOf(address(vault)) >= 101 ether + amount1, "token1 not returned");
    }

    function testEmergencyExitCanOnlyReturnEverythingToVault() external {
        vault.investAggregateLiquidity(manager, 50 ether, 100 ether, 1, DEADLINE);
        (uint256 amount0, uint256 amount1) = manager.emergencyExit(1, 1, DEADLINE);
        require(amount0 > 0 && amount1 > 0, "exit assets missing");
        require(manager.managedShares() == 0, "position still active");
        require(manager.paused(), "manager not paused");
        require(token0.balanceOf(address(manager)) == 0, "manager retained token0");
        require(token1.balanceOf(address(manager)) == 0, "manager retained token1");
        require(token0.balanceOf(address(vault)) + amount0 >= AMOUNT0, "token0 lost");
        require(token1.balanceOf(address(vault)) + amount1 >= AMOUNT1, "token1 lost");
    }

    function testRejectsUnauthorizedInvestmentAndManagerRemovalWithPosition() external {
        (bool unauthorized,) =
            address(manager).call(abi.encodeCall(ShieldedLPManager.invest, (1, 1, 1, DEADLINE)));
        require(!unauthorized, "unauthorized investment accepted");
        vault.investAggregateLiquidity(manager, 50 ether, 100 ether, 1, DEADLINE);
        (bool removed,) =
            address(vault).call(abi.encodeCall(ZKBlastVault.setLPManager, (manager, false)));
        require(!removed, "active manager removed");
    }

    function _requireSolvent(address asset, uint256 expectedLiability) private view {
        (uint256 liquid, uint256 managed, uint256 liability, bool solvent) =
            vault.accountedAssets(asset);
        require(liability == expectedLiability, "wrong liability");
        require(liquid + managed >= liability, "asset conservation failed");
        require(solvent, "asset insolvent");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DammPool } from "../src/core/DammPool.sol";
import { DlmmPool } from "../src/core/DlmmPool.sol";
import { PoolFactory } from "../src/core/PoolFactory.sol";
import { PoolRegistry } from "../src/core/PoolRegistry.sol";
import { PoolModel } from "../src/core/PoolTypes.sol";
import { PositionManager } from "../src/liquidity/PositionManager.sol";
import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";
import { PoolQuoter } from "../src/router/PoolQuoter.sol";
import { SwapRouter } from "../src/router/SwapRouter.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";

contract IntegrationSurfaceTest {
    MockERC20 private token0;
    MockERC20 private token1;
    PoolRegistry private registry;
    PoolFactory private factory;
    DammPool private damm;
    DlmmPool private dlmm;
    PoolQuoter private quoter;
    SwapRouter private router;
    PositionManager private positions;
    uint256 private constant DEADLINE = type(uint256).max;

    function setUp() public {
        MockERC20 tokenA = new MockERC20("Token A", "TKA");
        MockERC20 tokenB = new MockERC20("Token B", "TKB");
        token0 = address(tokenA) < address(tokenB) ? tokenA : tokenB;
        token1 = address(tokenA) < address(tokenB) ? tokenB : tokenA;
        token0.mint(address(this), 100_000 ether);
        token1.mint(address(this), 100_000 ether);

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
        damm = DammPool(
            factory.createPool(address(token0), address(token1), PoolModel.DAMM, 3_000, 0)
        );
        dlmm = DlmmPool(
            factory.createPool(address(token0), address(token1), PoolModel.DLMM, 3_000, 25)
        );

        quoter = new PoolQuoter();
        SwapRouter routerImplementation = new SwapRouter();
        router = SwapRouter(
            address(
                new ERC1967Proxy(
                    address(routerImplementation),
                    abi.encodeCall(SwapRouter.initialize, (address(this), address(this), registry))
                )
            )
        );
        PositionManager managerImplementation = new PositionManager();
        positions = PositionManager(
            address(
                new ERC1967Proxy(
                    address(managerImplementation),
                    abi.encodeCall(
                        PositionManager.initialize, (address(this), address(this), registry)
                    )
                )
            )
        );

        token0.approve(address(damm), type(uint256).max);
        token1.approve(address(damm), type(uint256).max);
        token0.approve(address(dlmm), type(uint256).max);
        token1.approve(address(dlmm), type(uint256).max);
        token0.approve(address(router), type(uint256).max);
        token1.approve(address(router), type(uint256).max);
        token0.approve(address(positions), type(uint256).max);
        token1.approve(address(positions), type(uint256).max);
        damm.addLiquidity(1_000 ether, 2_000 ether, 1, address(this), DEADLINE);
        dlmm.addLiquidity(0, 1_000 ether, 2_000 ether, 1, address(this), DEADLINE);
    }

    function testDammQuoteMatchesRoutedExecution() external {
        (uint256 quoted,) = quoter.quoteDammExactInput(damm, address(token0), 10 ether);
        uint256 beforeBalance = token1.balanceOf(address(this));
        uint256 output = router.swapDammExactInput(
            damm, address(token0), 10 ether, quoted, address(this), DEADLINE
        );
        require(output == quoted, "quote mismatch");
        require(token1.balanceOf(address(this)) == beforeBalance + output, "recipient");
        require(token0.allowance(address(router), address(damm)) == 0, "approval retained");
    }

    function testDlmmQuoteMatchesRoutedExecution() external {
        (uint256 quoted, int24 finalBin,) = quoter.quoteDlmmExactInput(dlmm, true, 10 ether, 1);
        uint256 output =
            router.swapDlmmExactInput(dlmm, true, 10 ether, quoted, 1, address(this), DEADLINE);
        require(output == quoted, "quote mismatch");
        require(dlmm.activeBin() == finalBin, "final bin");
        require(token0.allowance(address(router), address(dlmm)) == 0, "approval retained");
    }

    function testPositionLifecycleForDamm() external {
        (uint256 positionId, uint256 initialShares) =
            positions.createDammPosition(damm, 10 ether, 20 ether, 1, DEADLINE);
        (address owner, address pool, PoolModel model,, uint256 storedShares) =
            positions.positions(positionId);
        require(owner == address(this) && pool == address(damm), "identity");
        require(model == PoolModel.DAMM && storedShares == initialShares, "position state");
        uint256 added = positions.increasePosition(positionId, 5 ether, 10 ether, 1, DEADLINE);
        positions.decreasePosition(positionId, initialShares + added, 1, 1, address(this), DEADLINE);
        (owner,,,,) = positions.positions(positionId);
        require(owner == address(0), "position not closed");
    }

    function testPositionLifecycleForDlmm() external {
        (uint256 positionId, uint256 shares) =
            positions.createDlmmPosition(dlmm, 4, 10 ether, 10 ether, 1, DEADLINE);
        (address owner, address pool, PoolModel model, int24 binId,) =
            positions.positions(positionId);
        require(owner == address(this) && pool == address(dlmm), "identity");
        require(model == PoolModel.DLMM && binId == 4, "bin state");
        positions.decreasePosition(positionId, shares, 1, 1, address(this), DEADLINE);
    }

    function testRouterRejectsUnregisteredPool() external {
        PoolRegistry emptyRegistryImplementation = new PoolRegistry();
        PoolRegistry emptyRegistry = PoolRegistry(
            address(
                new ERC1967Proxy(
                    address(emptyRegistryImplementation),
                    abi.encodeCall(
                        PoolRegistry.initialize, (address(this), address(this), address(this))
                    )
                )
            )
        );
        SwapRouter implementation = new SwapRouter();
        SwapRouter isolatedRouter = SwapRouter(
            address(
                new ERC1967Proxy(
                    address(implementation),
                    abi.encodeCall(
                        SwapRouter.initialize, (address(this), address(this), emptyRegistry)
                    )
                )
            )
        );
        token0.approve(address(isolatedRouter), type(uint256).max);
        (bool success,) = address(isolatedRouter)
            .call(
                abi.encodeCall(
                    SwapRouter.swapDammExactInput,
                    (damm, address(token0), 1 ether, uint256(1), address(this), DEADLINE)
                )
            );
        require(!success, "unregistered route");
    }
}

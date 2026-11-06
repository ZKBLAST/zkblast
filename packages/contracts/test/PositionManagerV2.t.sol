// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DlmmPoolV2 } from "../src/core/DlmmPoolV2.sol";
import { PoolKey, PoolKeyLib, PoolModel } from "../src/core/PoolTypes.sol";
import { PoolRegistry } from "../src/core/PoolRegistry.sol";
import { PositionManager } from "../src/liquidity/PositionManager.sol";
import { PositionManagerV2 } from "../src/liquidity/PositionManagerV2.sol";
import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";

contract PositionManagerV2Test {
    MockERC20 private token0;
    MockERC20 private token1;
    DlmmPoolV2 private pool;
    PositionManagerV2 private manager;
    uint256 private constant DEADLINE = type(uint256).max;

    function setUp() public {
        MockERC20 tokenA = new MockERC20("Token A", "TKA");
        MockERC20 tokenB = new MockERC20("Token B", "TKB");
        PoolKey memory key =
            PoolKeyLib.normalize(address(tokenA), address(tokenB), PoolModel.DLMM, 3_000, 25);
        pool = new DlmmPoolV2(key, address(this), 0);
        token0 = MockERC20(key.token0);
        token1 = MockERC20(key.token1);

        PoolRegistry registryImplementation = new PoolRegistry();
        PoolRegistry registry = PoolRegistry(
            address(
                new ERC1967Proxy(
                    address(registryImplementation),
                    abi.encodeCall(
                        PoolRegistry.initialize, (address(this), address(this), address(this))
                    )
                )
            )
        );
        registry.registerPool(PoolKeyLib.id(key), address(pool), key);
        PositionManagerV2 implementation = new PositionManagerV2();
        manager = PositionManagerV2(
            address(
                new ERC1967Proxy(
                    address(implementation),
                    abi.encodeCall(
                        PositionManager.initialize, (address(this), address(this), registry)
                    )
                )
            )
        );
        token0.mint(address(this), 1_000_000 ether);
        token1.mint(address(this), 1_000_000 ether);
        token0.approve(address(manager), type(uint256).max);
        token1.approve(address(manager), type(uint256).max);
    }

    function testCreatesIncreasesDecreasesAndClosesRange() external {
        DlmmPoolV2.AddBin[] memory additions = _rangeAdditions(100 ether);
        uint256 positionId = manager.createRangePosition(pool, additions, 0, DEADLINE);
        (address owner, address storedPool, int24 lower, int24 upper, bool open) =
            manager.rangePositions(positionId);
        require(owner == address(this) && storedPool == address(pool), "identity");
        require(lower == -1 && upper == 1 && open, "range");
        require(manager.rangeShares(positionId, -1) > 0, "lower shares");
        require(manager.rangeShares(positionId, 1) > 0, "upper shares");

        manager.increaseRangePosition(positionId, _rangeAdditions(10 ether), 0, DEADLINE);
        manager.decreaseRangePosition(positionId, 2_500, 1, 1, address(this), DEADLINE);
        manager.closeRangePosition(positionId, 1, 1, address(this), DEADLINE);
        (, , , , open) = manager.rangePositions(positionId);
        require(!open, "position remained open");
    }

    function testV1StorageSlotsRemainReadableAfterExtension() external view {
        require(address(manager.registry()) != address(0), "registry lost");
        require(manager.nextPositionId() == 1, "v1 counter changed");
        require(manager.nextRangePositionId() == 0, "range counter initialized incorrectly");
    }

    function _rangeAdditions(uint256 amount)
        private
        pure
        returns (DlmmPoolV2.AddBin[] memory additions)
    {
        additions = new DlmmPoolV2.AddBin[](3);
        additions[0] = DlmmPoolV2.AddBin(-1, 0, amount, 1);
        additions[1] = DlmmPoolV2.AddBin(0, amount, amount, 1);
        additions[2] = DlmmPoolV2.AddBin(1, amount, 0, 1);
    }
}

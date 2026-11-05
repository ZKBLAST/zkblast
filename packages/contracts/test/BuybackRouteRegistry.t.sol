// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC1967Proxy} from "../src/proxy/ERC1967Proxy.sol";
import {BuybackRouteRegistry, IAssistanceReferenceOracle} from "../src/revenue/BuybackRouteRegistry.sol";
import {AssistanceFundTypes} from "../src/revenue/AssistanceFundTypes.sol";

interface VmBuybackRoute {
    function warp(uint256 timestamp) external;
}

contract RouteGovernanceMock {
    function configure(BuybackRouteRegistry registry, bytes32 routeId, BuybackRouteRegistry.Route calldata config)
        external
    {
        registry.configureRoute(routeId, config);
    }
}

contract RouteTokenMock {
    mapping(address account => uint256 amount) public balanceOf;

    function mint(address account, uint256 amount) external {
        balanceOf[account] += amount;
    }
}

contract RouteOracleMock is IAssistanceReferenceOracle {
    uint256 public price;
    uint64 public updatedAt;
    uint32 public observations;

    function set(uint256 price_, uint64 updatedAt_, uint32 observations_) external {
        price = price_;
        updatedAt = updatedAt_;
        observations = observations_;
    }

    function referencePrice(address, address) external view returns (uint256, uint64, uint32) {
        return (price, updatedAt, observations);
    }
}

contract RouteAdapterCallerMock {
    function consume(
        BuybackRouteRegistry registry,
        bytes32 routeId,
        uint256 amountIn,
        uint256 minimumAmountOut,
        uint256 quotedAmountOut,
        uint256 spotProbeAmountIn,
        uint256 spotProbeAmountOut,
        uint256 deadline
    ) external returns (uint256, uint256) {
        BuybackRouteRegistry.ExecutionRequest memory request =
            BuybackRouteRegistry.ExecutionRequest({
                amountIn: amountIn,
                minimumAmountOut: minimumAmountOut,
                quotedAmountOut: quotedAmountOut,
                spotProbeAmountIn: spotProbeAmountIn,
                spotProbeAmountOut: spotProbeAmountOut,
                deadline: deadline
            });
        return registry.consumeAndValidate(routeId, request);
    }
}

contract RouteCodeMock {}

contract BuybackRouteRegistryTest {
    VmBuybackRoute private constant vm = VmBuybackRoute(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant ROUTE_ID = keccak256("USDG_ZKBLAST_DAMM_V1");

    RouteGovernanceMock private governance;
    BuybackRouteRegistry private registry;
    RouteTokenMock private input;
    RouteTokenMock private output;
    RouteOracleMock private oracle;
    RouteAdapterCallerMock private adapter;
    RouteCodeMock private pool;
    RouteCodeMock private router;

    function setUp() public {
        vm.warp(1_800_000_000);
        governance = new RouteGovernanceMock();
        BuybackRouteRegistry implementation = new BuybackRouteRegistry();
        registry = BuybackRouteRegistry(
            address(
                new ERC1967Proxy(
                    address(implementation), abi.encodeCall(BuybackRouteRegistry.initialize, (address(governance)))
                )
            )
        );
        input = new RouteTokenMock();
        output = new RouteTokenMock();
        oracle = new RouteOracleMock();
        adapter = new RouteAdapterCallerMock();
        pool = new RouteCodeMock();
        router = new RouteCodeMock();
        input.mint(address(pool), 1_000);
        oracle.set(2e18, uint64(block.timestamp), 10);
        governance.configure(registry, ROUTE_ID, _config(address(adapter)));
    }

    function testValidatesAndConsumesBoundedRouteBudget() external {
        (uint256 referencePrice, uint256 executionPrice) =
            adapter.consume(registry, ROUTE_ID, 60, 119, 120, 10, 20, block.timestamp + 30);
        require(referencePrice == 2e18 && executionPrice == 2e18, "price");
        (uint64 day, uint64 lastExecutionAt, uint256 spent) = registry.spendWindow(ROUTE_ID);
        require(day == block.timestamp / 1 days, "day");
        require(lastExecutionAt == block.timestamp && spent == 60, "window");
    }

    function testRejectsRouteInjectionAndIdentityMutation() external {
        RouteAdapterCallerMock attacker = new RouteAdapterCallerMock();
        (bool injected,) = address(attacker)
            .call(abi.encodeCall(attacker.consume, (registry, ROUTE_ID, 60, 119, 120, 10, 20, block.timestamp + 30)));
        require(!injected, "route injected");

        BuybackRouteRegistry.Route memory changed = _config(address(adapter));
        changed.pool = address(new RouteCodeMock());
        (bool mutated,) = address(governance).call(abi.encodeCall(governance.configure, (registry, ROUTE_ID, changed)));
        require(!mutated, "identity mutated");
    }

    function testRejectsStaleOracleAndInsufficientHistory() external {
        oracle.set(2e18, uint64(block.timestamp - 61), 10);
        require(!_consume(), "stale accepted");
        oracle.set(2e18, uint64(block.timestamp), 1);
        require(!_consume(), "history accepted");
    }

    function testRejectsLowLiquiditySlippageAndDeviation() external {
        BuybackRouteRegistry.Route memory lowLiquidity = _config(address(adapter));
        lowLiquidity.limits.minimumPoolLiquidity = 2_000;
        bytes32 lowLiquidityId = keccak256("LOW_LIQUIDITY");
        governance.configure(registry, lowLiquidityId, lowLiquidity);
        (bool liquid,) = address(adapter)
            .call(
                abi.encodeCall(adapter.consume, (registry, lowLiquidityId, 60, 119, 120, 10, 20, block.timestamp + 30))
            );
        require(!liquid, "low liquidity accepted");

        (bool looseSlippage,) = address(adapter)
            .call(abi.encodeCall(adapter.consume, (registry, ROUTE_ID, 60, 114, 120, 10, 20, block.timestamp + 30)));
        require(!looseSlippage, "loose slippage accepted");
        oracle.set(3e18, uint64(block.timestamp), 10);
        require(!_consume(), "deviation accepted");
        oracle.set(1.9e18, uint64(block.timestamp), 10);
        (bool priceImpact,) = address(adapter)
            .call(abi.encodeCall(adapter.consume, (registry, ROUTE_ID, 60, 113, 114, 10, 20, block.timestamp + 30)));
        require(!priceImpact, "price impact accepted");
    }

    function testRejectsCooldownAndDailyLimit() external {
        adapter.consume(registry, ROUTE_ID, 60, 119, 120, 10, 20, block.timestamp + 30);
        require(!_consume(), "cooldown accepted");
        vm.warp(block.timestamp + 11);
        require(!_consume(), "daily limit accepted");
    }

    function _consume() private returns (bool accepted) {
        (accepted,) = address(adapter)
            .call(abi.encodeCall(adapter.consume, (registry, ROUTE_ID, 60, 119, 120, 10, 20, block.timestamp + 30)));
    }

    function _config(address adapterAddress) private view returns (BuybackRouteRegistry.Route memory config) {
        config.inputAsset = address(input);
        config.outputAsset = address(output);
        config.pool = address(pool);
        config.router = address(router);
        config.adapter = adapterAddress;
        config.oracle = address(oracle);
        config.limits = AssistanceFundTypes.ExecutionLimits({
            minimumAmount: 10,
            maximumAmount: 60,
            maximumDailySpend: 100,
            minimumPoolLiquidity: 100,
            cooldownSeconds: 10,
            oracleStalenessSeconds: 60,
            swapDeadlineSeconds: 60,
            maximumSlippageBps: 100,
            maximumPriceImpactBps: 100,
            maximumOracleDeviationBps: 100
        });
        config.model = BuybackRouteRegistry.PoolModel.DAMM;
        config.inputDecimals = 18;
        config.outputDecimals = 18;
        config.minimumOracleObservations = 2;
        config.enabled = true;
    }
}

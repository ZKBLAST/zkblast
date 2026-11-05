// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20Minimal} from "../src/interfaces/IERC20Minimal.sol";
import {ERC1967Proxy} from "../src/proxy/ERC1967Proxy.sol";
import {AssistanceFeeCollector} from "../src/revenue/AssistanceFeeCollector.sol";
import {AssistanceFundExecutor} from "../src/revenue/AssistanceFundExecutor.sol";
import {AssistanceFundTypes} from "../src/revenue/AssistanceFundTypes.sol";
import {BurnModule, IBurnableSupplyToken} from "../src/revenue/BurnModule.sol";
import {BuybackRouteRegistry} from "../src/revenue/BuybackRouteRegistry.sol";

contract ExecutorGovernanceMock {
    function configure(BuybackRouteRegistry registry, bytes32 routeId, BuybackRouteRegistry.Route calldata config)
        external
    {
        registry.configureRoute(routeId, config);
    }

    function bindBurnModule(BurnModule module, address executor) external {
        module.bindAssistanceFund(executor);
    }

    function pause(AssistanceFundExecutor executor, bool paused) external {
        executor.setPaused(paused);
    }
}

contract ExecutorTokenMock is IBurnableSupplyToken {
    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;
    uint256 public totalSupply;

    function mint(address recipient, uint256 amount) external {
        balanceOf[recipient] += amount;
        totalSupply += amount;
    }

    function burn(uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool) {
        allowance[sender][msg.sender] -= amount;
        balanceOf[sender] -= amount;
        balanceOf[recipient] += amount;
        return true;
    }
}

contract ExecutorCollectorMock {
    IERC20Minimal public immutable inputAsset;
    bool public failRelease;

    constructor(IERC20Minimal inputAsset_) {
        inputAsset = inputAsset_;
    }

    function setFailRelease(bool fail) external {
        failRelease = fail;
    }

    function releaseBuyback(address asset, address recipient, uint256 amount) external {
        require(!failRelease && asset == address(inputAsset), "release");
        inputAsset.transfer(recipient, amount);
    }
}

contract ExecutorAdapterMock {
    IERC20Minimal public immutable inputAsset;
    ExecutorTokenMock public immutable outputAsset;
    address public immutable executor;
    bool public failSwap;

    constructor(IERC20Minimal inputAsset_, ExecutorTokenMock outputAsset_, address executor_) {
        inputAsset = inputAsset_;
        outputAsset = outputAsset_;
        executor = executor_;
    }

    function setFailSwap(bool fail) external {
        failSwap = fail;
    }

    function execute(bytes32, uint256 amountIn, uint256 minimumAmountOut, uint256)
        external
        returns (uint256 amountOut, uint256 referencePriceX18, uint256 executionPriceX18)
    {
        require(msg.sender == executor && !failSwap, "swap");
        inputAsset.transferFrom(msg.sender, address(this), amountIn);
        amountOut = amountIn * 2;
        require(amountOut >= minimumAmountOut, "minimum");
        outputAsset.mint(msg.sender, amountOut);
        return (amountOut, 2e18, 2e18);
    }
}

contract ExecutorCodeMock {}

contract AssistanceFundExecutorTest {
    bytes32 private constant ROUTE_ID = keccak256("USDG_ZKBLAST_DAMM_V1");

    ExecutorGovernanceMock private governance;
    ExecutorTokenMock private input;
    ExecutorTokenMock private protocolToken;
    ExecutorCollectorMock private collector;
    BuybackRouteRegistry private registry;
    BurnModule private burnModule;
    AssistanceFundExecutor private executor;
    ExecutorAdapterMock private adapter;

    function setUp() public {
        governance = new ExecutorGovernanceMock();
        input = new ExecutorTokenMock();
        protocolToken = new ExecutorTokenMock();
        collector = new ExecutorCollectorMock(input);

        BuybackRouteRegistry registryImplementation = new BuybackRouteRegistry();
        registry = BuybackRouteRegistry(
            address(
                new ERC1967Proxy(
                    address(registryImplementation),
                    abi.encodeCall(BuybackRouteRegistry.initialize, (address(governance)))
                )
            )
        );
        burnModule = new BurnModule(protocolToken, address(governance));
        AssistanceFundExecutor implementation = new AssistanceFundExecutor();
        executor = AssistanceFundExecutor(
            address(
                new ERC1967Proxy(
                    address(implementation),
                    abi.encodeCall(
                        AssistanceFundExecutor.initialize,
                        (address(governance), AssistanceFeeCollector(address(collector)), registry, burnModule)
                    )
                )
            )
        );
        governance.bindBurnModule(burnModule, address(executor));
        adapter = new ExecutorAdapterMock(input, protocolToken, address(executor));
        governance.configure(registry, ROUTE_ID, _config());
        input.mint(address(collector), 1_000);
    }

    function testPermissionlessExecutionSpendsAndBurnsAtomically() external {
        uint256 supplyBefore = protocolToken.totalSupply();
        uint256 burned = executor.executeBuyback(ROUTE_ID, 100, 199, block.timestamp + 30);
        require(burned == 200, "burn amount");
        require(protocolToken.totalSupply() == supplyBefore, "output not burned");
        require(protocolToken.balanceOf(address(executor)) == 0, "executor output");
        require(protocolToken.balanceOf(address(burnModule)) == 0, "module output");
        require(input.allowance(address(executor), address(adapter)) == 0, "allowance");
    }

    function testSwapFailureRevertsReleasedBudget() external {
        adapter.setFailSwap(true);
        uint256 collectorBefore = input.balanceOf(address(collector));
        (bool accepted,) =
            address(executor).call(abi.encodeCall(executor.executeBuyback, (ROUTE_ID, 100, 199, block.timestamp + 30)));
        require(!accepted, "failed swap accepted");
        require(input.balanceOf(address(collector)) == collectorBefore, "budget not restored");
        require(input.balanceOf(address(executor)) == 0, "executor retained input");
    }

    function testGovernancePauseBlocksExecutionWithoutMovingFunds() external {
        governance.pause(executor, true);
        uint256 collectorBefore = input.balanceOf(address(collector));
        (bool accepted,) =
            address(executor).call(abi.encodeCall(executor.executeBuyback, (ROUTE_ID, 100, 199, block.timestamp + 30)));
        require(!accepted, "paused execution");
        require(input.balanceOf(address(collector)) == collectorBefore, "funds moved");
    }

    function _config() private returns (BuybackRouteRegistry.Route memory config) {
        ExecutorCodeMock pool = new ExecutorCodeMock();
        ExecutorCodeMock router = new ExecutorCodeMock();
        ExecutorCodeMock oracle = new ExecutorCodeMock();
        config.inputAsset = address(input);
        config.outputAsset = address(protocolToken);
        config.pool = address(pool);
        config.router = address(router);
        config.adapter = address(adapter);
        config.oracle = address(oracle);
        config.limits = AssistanceFundTypes.ExecutionLimits({
            minimumAmount: 1,
            maximumAmount: 1_000,
            maximumDailySpend: 1_000,
            minimumPoolLiquidity: 1,
            cooldownSeconds: 1,
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

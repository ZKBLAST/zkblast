// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";
import { AssistanceFeeCollector } from "../src/revenue/AssistanceFeeCollector.sol";
import { AmmProtocolFeeAdapter } from "../src/revenue/AmmProtocolFeeAdapter.sol";
import { AssistanceFundTypes } from "../src/revenue/AssistanceFundTypes.sol";
import { DbcProtocolRevenueAdapter } from "../src/revenue/DbcProtocolRevenueAdapter.sol";
import {
    LaunchpadProtocolRevenueAdapter
} from "../src/revenue/LaunchpadProtocolRevenueAdapter.sol";
import {
    IAmmProtocolFeeSource,
    IDbcProtocolFeeSource,
    ILaunchpadRevenueSplitter
} from "../src/revenue/IProtocolRevenueSources.sol";
import { ProtocolFeeRegistry } from "../src/revenue/ProtocolFeeRegistry.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";

contract LaunchpadSplitterMock {
    MockERC20 private immutable _asset;
    mapping(bytes32 snapshotId => uint256 amount) public claimable;

    constructor(MockERC20 asset_) {
        _asset = asset_;
    }

    function setClaimable(bytes32 snapshotId, uint256 amount) external {
        claimable[snapshotId] = amount;
    }

    function claim(bytes32 snapshotId) external returns (uint256 amount) {
        amount = claimable[snapshotId];
        require(amount != 0, "nothing");
        claimable[snapshotId] = 0;
        _asset.transfer(msg.sender, amount);
    }
}

contract DbcFeeSourceMock {
    MockERC20 private immutable _asset;
    uint256 public protocolFees;

    constructor(MockERC20 asset_) {
        _asset = asset_;
    }

    function quoteToken() external view returns (address) {
        return address(_asset);
    }

    function setProtocolFees(uint256 amount) external {
        protocolFees = amount;
    }

    function claimFees(uint8 allocation) external returns (uint256 amount) {
        require(allocation == 2, "allocation");
        amount = protocolFees;
        require(amount != 0, "nothing");
        protocolFees = 0;
        _asset.transfer(msg.sender, amount);
    }
}

contract AmmFeeSourceMock {
    MockERC20 private immutable _token0;
    MockERC20 private immutable _token1;
    address public protocolFeeRecipient;
    uint256 public amount0;
    uint256 public amount1;
    bool public misreport;

    constructor(MockERC20 token0_, MockERC20 token1_) {
        _token0 = token0_;
        _token1 = token1_;
    }

    function token0() external view returns (address) {
        return address(_token0);
    }

    function token1() external view returns (address) {
        return address(_token1);
    }

    function configure(address recipient, uint256 amount0_, uint256 amount1_) external {
        protocolFeeRecipient = recipient;
        amount0 = amount0_;
        amount1 = amount1_;
    }

    function setMisreport(bool enabled) external {
        misreport = enabled;
    }

    function collectProtocolFees() external returns (uint256 collected0, uint256 collected1) {
        require(msg.sender == protocolFeeRecipient, "recipient");
        collected0 = amount0;
        collected1 = amount1;
        amount0 = 0;
        amount1 = 0;
        if (collected0 != 0) _token0.transfer(msg.sender, collected0);
        if (collected1 != 0) _token1.transfer(msg.sender, collected1);
        if (misreport) collected0 += 1;
    }
}

contract ProtocolRevenueAdaptersTest {
    function _system()
        private
        returns (ProtocolFeeRegistry registry, AssistanceFeeCollector collector)
    {
        ProtocolFeeRegistry registryImplementation = new ProtocolFeeRegistry();
        registry = ProtocolFeeRegistry(
            address(
                new ERC1967Proxy(
                    address(registryImplementation),
                    abi.encodeCall(ProtocolFeeRegistry.initialize, (address(this)))
                )
            )
        );
        AssistanceFeeCollector collectorImplementation = new AssistanceFeeCollector();
        collector = AssistanceFeeCollector(
            address(
                new ERC1967Proxy(
                    address(collectorImplementation),
                    abi.encodeCall(AssistanceFeeCollector.initialize, (address(this), registry))
                )
            )
        );
    }

    function testLaunchpadAdapterForwardsOnlyProtocolClaim() external {
        (ProtocolFeeRegistry registry, AssistanceFeeCollector collector) = _system();
        MockERC20 asset = new MockERC20("USDG", "USDG");
        LaunchpadSplitterMock splitter = new LaunchpadSplitterMock(asset);
        bytes32 adapterId = AssistanceFundTypes.DBC_PROTOCOL_REVENUE_V1;
        LaunchpadProtocolRevenueAdapter adapter = new LaunchpadProtocolRevenueAdapter(
            collector, ILaunchpadRevenueSplitter(address(splitter)), address(asset), adapterId
        );
        registry.registerSource(address(adapter), address(asset), adapterId);

        bytes32 snapshotId = keccak256("snapshot");
        asset.mint(address(splitter), 1_000);
        splitter.setClaimable(snapshotId, 1_000);
        adapter.collect(snapshotId);

        AssistanceFundTypes.AssetLedger memory ledger = collector.assetLedger(address(asset));
        require(ledger.collected == 1_000, "collected");
        require(ledger.allocatedBuyback == 990, "buyback");
        require(ledger.allocatedTreasury == 10, "treasury");
        require(asset.allowance(address(adapter), address(collector)) == 0, "allowance");
    }

    function testDbcAdapterForwardsProtocolAllocationOnly() external {
        (ProtocolFeeRegistry registry, AssistanceFeeCollector collector) = _system();
        MockERC20 asset = new MockERC20("USDG", "USDG");
        DbcFeeSourceMock pool = new DbcFeeSourceMock(asset);
        bytes32 adapterId = AssistanceFundTypes.DBC_PROTOCOL_REVENUE_V1;
        DbcProtocolRevenueAdapter adapter = new DbcProtocolRevenueAdapter(
            collector, IDbcProtocolFeeSource(address(pool)), adapterId
        );
        registry.registerSource(address(adapter), address(asset), adapterId);

        asset.mint(address(pool), 2_000);
        pool.setProtocolFees(2_000);
        adapter.collect();

        AssistanceFundTypes.AssetLedger memory ledger = collector.assetLedger(address(asset));
        require(ledger.collected == 2_000, "collected");
        require(pool.protocolFees() == 0, "source fees");
        require(asset.allowance(address(adapter), address(collector)) == 0, "allowance");
    }

    function testAmmAdapterReconcilesBothAssetsAndRequiresRecipient() external {
        (ProtocolFeeRegistry registry, AssistanceFeeCollector collector) = _system();
        MockERC20 token0 = new MockERC20("Token 0", "T0");
        MockERC20 token1 = new MockERC20("Token 1", "T1");
        AmmFeeSourceMock pool = new AmmFeeSourceMock(token0, token1);
        AmmProtocolFeeAdapter adapter = new AmmProtocolFeeAdapter(
            collector,
            IAmmProtocolFeeSource(address(pool)),
            AssistanceFundTypes.DAMM_PROTOCOL_FEE_V1,
            AssistanceFundTypes.DAMM_PROTOCOL_FEE_V1
        );
        registry.registerSource(
            address(adapter), address(token0), AssistanceFundTypes.DAMM_PROTOCOL_FEE_V1
        );
        registry.registerSource(
            address(adapter), address(token1), AssistanceFundTypes.DAMM_PROTOCOL_FEE_V1
        );

        pool.configure(address(this), 400, 600);
        (bool wrongRecipient,) = address(adapter).call(abi.encodeCall(adapter.collect, ()));
        require(!wrongRecipient, "wrong recipient accepted");

        token0.mint(address(pool), 400);
        token1.mint(address(pool), 600);
        pool.configure(address(adapter), 400, 600);
        adapter.collect();

        AssistanceFundTypes.AssetLedger memory ledger0 = collector.assetLedger(address(token0));
        AssistanceFundTypes.AssetLedger memory ledger1 = collector.assetLedger(address(token1));
        require(ledger0.collected == 400, "token0");
        require(ledger1.collected == 600, "token1");
        require(token0.allowance(address(adapter), address(collector)) == 0, "allowance0");
        require(token1.allowance(address(adapter), address(collector)) == 0, "allowance1");

        (bool duplicate,) = address(adapter).call(abi.encodeCall(adapter.collect, ()));
        require(!duplicate, "empty duplicate accepted");
    }

    function testAmmAdapterRevertsPartialOrDishonestCollection() external {
        (ProtocolFeeRegistry registry, AssistanceFeeCollector collector) = _system();
        MockERC20 token0 = new MockERC20("Token 0", "T0");
        MockERC20 token1 = new MockERC20("Token 1", "T1");
        AmmFeeSourceMock pool = new AmmFeeSourceMock(token0, token1);
        AmmProtocolFeeAdapter adapter = new AmmProtocolFeeAdapter(
            collector,
            IAmmProtocolFeeSource(address(pool)),
            AssistanceFundTypes.DLMM_PROTOCOL_FEE_V1,
            AssistanceFundTypes.DLMM_PROTOCOL_FEE_V1
        );
        registry.registerSource(
            address(adapter), address(token0), AssistanceFundTypes.DLMM_PROTOCOL_FEE_V1
        );
        registry.registerSource(
            address(adapter), address(token1), AssistanceFundTypes.DLMM_PROTOCOL_FEE_V1
        );
        token0.mint(address(pool), 100);
        pool.configure(address(adapter), 100, 0);
        pool.setMisreport(true);

        (bool accepted,) = address(adapter).call(abi.encodeCall(adapter.collect, ()));
        require(!accepted, "dishonest amount accepted");
        require(pool.amount0() == 100, "source state not reverted");
        AssistanceFundTypes.AssetLedger memory ledger = collector.assetLedger(address(token0));
        require(ledger.collected == 0, "partial revenue recorded");
    }
}

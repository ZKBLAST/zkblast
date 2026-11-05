// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC1967Proxy} from "../src/proxy/ERC1967Proxy.sol";
import {IERC20Minimal} from "../src/interfaces/IERC20Minimal.sol";
import {AssistanceFeeCollector} from "../src/revenue/AssistanceFeeCollector.sol";
import {AssistanceFundTypes} from "../src/revenue/AssistanceFundTypes.sol";
import {ProtocolFeeRegistry} from "../src/revenue/ProtocolFeeRegistry.sol";

contract AssistanceAssetMock is IERC20Minimal {
    mapping(address account => uint256 amount) private _balances;
    mapping(address owner => mapping(address spender => uint256 amount)) private _allowances;
    bool private immutable _taxed;

    constructor(bool taxed_) {
        _taxed = taxed_;
    }

    function mint(address recipient, uint256 amount) external {
        _balances[recipient] += amount;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function allowance(address owner, address spender) external view returns (uint256) {
        return _allowances[owner][spender];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _allowances[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        _transfer(msg.sender, recipient, amount);
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool) {
        uint256 allowed = _allowances[sender][msg.sender];
        require(allowed >= amount, "allowance");
        _allowances[sender][msg.sender] = allowed - amount;
        _transfer(sender, recipient, amount);
        return true;
    }

    function _transfer(address sender, address recipient, uint256 amount) private {
        require(_balances[sender] >= amount, "balance");
        _balances[sender] -= amount;
        _balances[recipient] += _taxed && amount != 0 ? amount - 1 : amount;
    }
}

contract AssistanceRevenueSourceMock {
    function record(
        AssistanceFeeCollector collector,
        AssistanceAssetMock asset,
        bytes32 sourceId,
        uint64 epoch,
        uint256 grossAmount,
        uint256 excludedObligations,
        uint256 eligibleAmount
    ) external {
        asset.approve(address(collector), eligibleAmount);
        collector.recordRevenue(
            sourceId,
            epoch,
            AssistanceFundTypes.RevenueKind.PROTOCOL_TRADE_FEE,
            grossAmount,
            excludedObligations,
            eligibleAmount
        );
    }
}

contract AssistanceBuybackExecutorMock {
    function release(AssistanceFeeCollector collector, address asset, uint256 amount) external {
        collector.releaseBuyback(asset, address(this), amount);
    }
}

contract AssistanceFeeCollectorTest {
    function _registry() private returns (ProtocolFeeRegistry value) {
        ProtocolFeeRegistry implementation = new ProtocolFeeRegistry();
        value = ProtocolFeeRegistry(
            address(
                new ERC1967Proxy(
                    address(implementation), abi.encodeCall(ProtocolFeeRegistry.initialize, (address(this)))
                )
            )
        );
    }

    function _collector(ProtocolFeeRegistry registry) private returns (AssistanceFeeCollector value) {
        AssistanceFeeCollector implementation = new AssistanceFeeCollector();
        value = AssistanceFeeCollector(
            address(
                new ERC1967Proxy(
                    address(implementation),
                    abi.encodeCall(AssistanceFeeCollector.initialize, (address(this), registry))
                )
            )
        );
    }

    function testAllocatesExactProtocolRevenueAndReconciles() external {
        ProtocolFeeRegistry registry = _registry();
        AssistanceFeeCollector collector = _collector(registry);
        AssistanceAssetMock asset = new AssistanceAssetMock(false);
        AssistanceRevenueSourceMock source = new AssistanceRevenueSourceMock();
        bytes32 id =
            registry.registerSource(address(source), address(asset), AssistanceFundTypes.DBC_PROTOCOL_REVENUE_V1);
        asset.mint(address(source), 10_000);

        source.record(collector, asset, id, 1, 15_000, 5_000, 10_000);
        AssistanceFundTypes.AssetLedger memory ledger = collector.assetLedger(address(asset));
        require(ledger.collected == 10_000, "collected");
        require(ledger.allocatedBuyback == 9_900, "buyback");
        require(ledger.allocatedTreasury == 100, "treasury");

        (uint256 balance, uint256 pending, uint256 treasury, uint256 liability, uint256 surplus, bool solvent) =
            collector.reconciliation(address(asset));
        require(balance == 10_000, "balance");
        require(pending == 9_900 && treasury == 100, "allocation");
        require(liability == 10_000 && surplus == 0 && solvent, "reconciliation");
    }

    function testRoundingResidualBelongsToTreasury() external {
        ProtocolFeeRegistry registry = _registry();
        AssistanceFeeCollector collector = _collector(registry);
        AssistanceAssetMock asset = new AssistanceAssetMock(false);
        AssistanceRevenueSourceMock source = new AssistanceRevenueSourceMock();
        bytes32 id = registry.registerSource(address(source), address(asset), AssistanceFundTypes.DAMM_PROTOCOL_FEE_V1);
        asset.mint(address(source), 1);
        source.record(collector, asset, id, 1, 1, 0, 1);

        AssistanceFundTypes.AssetLedger memory ledger = collector.assetLedger(address(asset));
        require(ledger.allocatedBuyback == 0, "buyback dust");
        require(ledger.allocatedTreasury == 1, "treasury dust");
    }

    function testRejectsUnregisteredCallerAndUnsupportedTokenBehavior() external {
        ProtocolFeeRegistry registry = _registry();
        AssistanceFeeCollector collector = _collector(registry);
        AssistanceAssetMock exactAsset = new AssistanceAssetMock(false);
        AssistanceRevenueSourceMock source = new AssistanceRevenueSourceMock();
        bytes32 exactId =
            registry.registerSource(address(source), address(exactAsset), AssistanceFundTypes.DLMM_PROTOCOL_FEE_V1);
        exactAsset.mint(address(this), 100);
        exactAsset.approve(address(collector), 100);
        (bool spoofed,) = address(collector)
            .call(
                abi.encodeCall(
                    collector.recordRevenue,
                    (exactId, uint64(1), AssistanceFundTypes.RevenueKind.PROTOCOL_POOL_FEE, 100, 0, 100)
                )
            );
        require(!spoofed, "spoof accepted");

        AssistanceAssetMock taxedAsset = new AssistanceAssetMock(true);
        AssistanceRevenueSourceMock taxedSource = new AssistanceRevenueSourceMock();
        bytes32 taxedId = registry.registerSource(
            address(taxedSource), address(taxedAsset), AssistanceFundTypes.DAMM_PROTOCOL_FEE_V1
        );
        taxedAsset.mint(address(taxedSource), 100);
        (bool taxedAccepted,) = address(taxedSource)
            .call(abi.encodeCall(taxedSource.record, (collector, taxedAsset, taxedId, uint64(1), 100, 0, 100)));
        require(!taxedAccepted, "taxed token accepted");
    }

    function testDirectTransferCreatesSurplusButNoRevenueCredit() external {
        ProtocolFeeRegistry registry = _registry();
        AssistanceFeeCollector collector = _collector(registry);
        AssistanceAssetMock asset = new AssistanceAssetMock(false);
        asset.mint(address(this), 50);
        asset.transfer(address(collector), 50);

        AssistanceFundTypes.AssetLedger memory ledger = collector.assetLedger(address(asset));
        require(ledger.collected == 0, "direct transfer credited");
        (uint256 balance,,,, uint256 surplus, bool solvent) = collector.reconciliation(address(asset));
        require(balance == 50 && surplus == 50 && solvent, "surplus");
    }

    function testBoundExecutorCanReleaseOnlyPendingBuyback() external {
        ProtocolFeeRegistry registry = _registry();
        AssistanceFeeCollector collector = _collector(registry);
        AssistanceAssetMock asset = new AssistanceAssetMock(false);
        AssistanceRevenueSourceMock source = new AssistanceRevenueSourceMock();
        bytes32 id = registry.registerSource(address(source), address(asset), AssistanceFundTypes.DAMM_PROTOCOL_FEE_V1);
        asset.mint(address(source), 10_000);
        source.record(collector, asset, id, 1, 10_000, 0, 10_000);

        AssistanceBuybackExecutorMock executor = new AssistanceBuybackExecutorMock();
        collector.bindBuybackExecutor(address(executor));
        executor.release(collector, address(asset), 9_900);
        require(asset.balanceOf(address(executor)) == 9_900, "released");
        AssistanceFundTypes.AssetLedger memory ledger = collector.assetLedger(address(asset));
        require(ledger.spentBuyback == 9_900, "spent");
        require(ledger.claimedTreasury == 0, "treasury touched");

        (bool exceeded,) = address(executor).call(abi.encodeCall(executor.release, (collector, address(asset), 1)));
        require(!exceeded, "buyback exceeded");
    }
}

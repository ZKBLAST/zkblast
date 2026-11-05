// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";
import { AssistanceFeeCollector } from "../src/revenue/AssistanceFeeCollector.sol";
import { AssistanceFundTypes } from "../src/revenue/AssistanceFundTypes.sol";
import { ProtocolFeeRegistry } from "../src/revenue/ProtocolFeeRegistry.sol";
import { TreasuryController } from "../src/revenue/TreasuryController.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";

contract TreasuryRevenueSourceMock {
    function record(
        AssistanceFeeCollector collector,
        MockERC20 asset,
        bytes32 sourceId,
        uint256 amount
    ) external {
        asset.approve(address(collector), amount);
        collector.recordRevenue(
            sourceId, 1, AssistanceFundTypes.RevenueKind.PROTOCOL_TRADE_FEE, amount, 0, amount
        );
    }
}

contract TreasuryControllerTest {
    function _system(address recipient)
        private
        returns (
            ProtocolFeeRegistry registry,
            AssistanceFeeCollector collector,
            TreasuryController controller
        )
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
        TreasuryController controllerImplementation = new TreasuryController();
        controller = TreasuryController(
            address(
                new ERC1967Proxy(
                    address(controllerImplementation),
                    abi.encodeCall(
                        TreasuryController.initialize, (address(this), collector, recipient)
                    )
                )
            )
        );
        collector.bindTreasuryController(address(controller));
    }

    function testClaimCanOnlyReleaseTreasuryAllocation() external {
        address recipient = address(0xBEEF);
        (
            ProtocolFeeRegistry registry,
            AssistanceFeeCollector collector,
            TreasuryController controller
        ) = _system(recipient);
        MockERC20 asset = new MockERC20("USDG", "USDG");
        TreasuryRevenueSourceMock source = new TreasuryRevenueSourceMock();
        bytes32 adapterId = AssistanceFundTypes.DBC_PROTOCOL_REVENUE_V1;
        bytes32 sourceId = registry.registerSource(address(source), address(asset), adapterId);
        asset.mint(address(source), 10_000);
        source.record(collector, asset, sourceId, 10_000);

        controller.claim(address(asset), 100);
        require(asset.balanceOf(recipient) == 100, "recipient");
        AssistanceFundTypes.AssetLedger memory ledger = collector.assetLedger(address(asset));
        require(ledger.claimedTreasury == 100, "claimed");
        require(ledger.spentBuyback == 0 && ledger.allocatedBuyback == 9_900, "buyback touched");

        (bool stoleBuyback,) =
            address(controller).call(abi.encodeCall(controller.claim, (address(asset), 9_900)));
        require(!stoleBuyback, "buyback released");
    }

    function testTimelockControlsRecipientPauseAndUnrelatedRecovery() external {
        address firstRecipient = address(0x1111);
        address nextRecipient = address(0x2222);
        (, AssistanceFeeCollector collector, TreasuryController controller) =
            _system(firstRecipient);
        require(address(collector) != address(0), "collector");

        controller.setRecipient(nextRecipient);
        require(controller.recipient() == nextRecipient, "recipient");
        controller.setPaused(true);
        require(controller.paused(), "pause");

        MockERC20 unrelated = new MockERC20("Other", "OTHER");
        unrelated.mint(address(controller), 50);
        controller.recoverUnrelatedToken(address(unrelated), nextRecipient);
        require(unrelated.balanceOf(nextRecipient) == 50, "recovery");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";
import { AssistanceFundTypes } from "../src/revenue/AssistanceFundTypes.sol";
import { ProtocolFeeRegistry } from "../src/revenue/ProtocolFeeRegistry.sol";

interface VmProtocolFeeRegistry {
    function chainId(uint256 newChainId) external;
}

contract ProtocolFeeSourceMock { }

contract ProtocolFeeAssetMock { }

contract ProtocolFeeRegistryActor {
    function register(
        ProtocolFeeRegistry registry,
        address source,
        address asset,
        bytes32 adapterId
    ) external returns (bytes32) {
        return registry.registerSource(source, asset, adapterId);
    }
}

contract ProtocolFeeRegistryTest {
    VmProtocolFeeRegistry private constant VM =
        VmProtocolFeeRegistry(address(uint160(uint256(keccak256("hevm cheat code")))));

    function _registry() private returns (ProtocolFeeRegistry value) {
        ProtocolFeeRegistry implementation = new ProtocolFeeRegistry();
        value = ProtocolFeeRegistry(
            address(
                new ERC1967Proxy(
                    address(implementation),
                    abi.encodeCall(ProtocolFeeRegistry.initialize, (address(this)))
                )
            )
        );
    }

    function testSourceIdentityIsAppendOnlyAndFailClosed() external {
        ProtocolFeeRegistry registry = _registry();
        ProtocolFeeSourceMock source = new ProtocolFeeSourceMock();
        ProtocolFeeAssetMock asset = new ProtocolFeeAssetMock();
        bytes32 adapterId = keccak256("ZKBLAST_DAMM_PROTOCOL_FEE_V1");

        bytes32 id = registry.registerSource(address(source), address(asset), adapterId);
        ProtocolFeeRegistry.SourceRecord memory record = registry.sourceRecord(id);
        require(record.chainId == block.chainid, "chain");
        require(record.source == address(source), "source");
        require(record.asset == address(asset), "asset");
        require(record.adapterId == adapterId, "adapter");
        require(record.status == AssistanceFundTypes.SourceStatus.ACTIVE, "status");
        require(registry.isActive(id, address(source), address(asset)), "not active");
        require(!registry.isActive(id, address(this), address(asset)), "spoof accepted");

        (bool duplicate,) = address(registry)
            .call(
                abi.encodeCall(
                    registry.registerSource, (address(source), address(asset), adapterId)
                )
            );
        require(!duplicate, "duplicate accepted");

        registry.setSourceActive(id, false);
        require(!registry.isActive(id, address(source), address(asset)), "still active");
        ProtocolFeeRegistry.SourceRecord memory disabled = registry.sourceRecord(id);
        require(disabled.source == address(source), "history rewritten");

        registry.setSourceActive(id, true);
        require(registry.isActive(id, address(source), address(asset)), "not restored");
    }

    function testOnlyGovernanceCanRegisterOrChangeStatus() external {
        ProtocolFeeRegistry registry = _registry();
        ProtocolFeeSourceMock source = new ProtocolFeeSourceMock();
        ProtocolFeeAssetMock asset = new ProtocolFeeAssetMock();
        ProtocolFeeRegistryActor actor = new ProtocolFeeRegistryActor();
        bytes32 adapterId = keccak256("ZKBLAST_DLMM_PROTOCOL_FEE_V1");

        (bool registered,) = address(actor)
            .call(
                abi.encodeCall(
                    actor.register, (registry, address(source), address(asset), adapterId)
                )
            );
        require(!registered, "unauthorized register");

        bytes32 id = registry.registerSource(address(source), address(asset), adapterId);
        (bool changed,) = address(actor).call(abi.encodeCall(registry.setSourceActive, (id, false)));
        require(!changed, "unauthorized status change");
    }

    function testSourceDomainChangesAcrossChainsAndRegistries() external {
        ProtocolFeeSourceMock source = new ProtocolFeeSourceMock();
        ProtocolFeeAssetMock asset = new ProtocolFeeAssetMock();
        bytes32 adapterId = keccak256("ZKBLAST_DBC_PROTOCOL_REVENUE_V1");

        VM.chainId(4663);
        ProtocolFeeRegistry robinhood = _registry();
        bytes32 robinhoodId = robinhood.sourceId(address(source), address(asset), adapterId);
        ProtocolFeeRegistry secondRegistry = _registry();
        bytes32 secondId = secondRegistry.sourceId(address(source), address(asset), adapterId);

        VM.chainId(999);
        ProtocolFeeRegistry hyperEvm = _registry();
        bytes32 hyperEvmId = hyperEvm.sourceId(address(source), address(asset), adapterId);

        require(robinhoodId != secondId, "registry collision");
        require(robinhoodId != hyperEvmId, "chain collision");
    }
}

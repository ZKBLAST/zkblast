// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";
import { DbcTypes } from "../src/dbc/DbcTypes.sol";
import { GraduationAdapterRegistry } from "../src/dbc/GraduationAdapterRegistry.sol";
import { IGraduationAdapter } from "../src/dbc/IGraduationAdapter.sol";

interface VmGraduationAdapterRegistry {
    function chainId(uint256 newChainId) external;
}

contract RegistryRouterMock { }
contract RegistryFactoryMock { }

contract RegistryAdapterMock is IGraduationAdapter {
    address private immutable _factory;

    constructor(address factory_) {
        _factory = factory_;
    }

    function migrationMode() external pure returns (DbcTypes.MigrationMode) {
        return DbcTypes.MigrationMode.DAMM;
    }

    function adapterVersion() external pure returns (uint32) {
        return 1;
    }

    function factory() external view returns (address) {
        return _factory;
    }

    function configurationHash() external view returns (bytes32) {
        return keccak256(abi.encode(uint32(1), DbcTypes.MigrationMode.DAMM, _factory));
    }

    function migrate(Migration calldata)
        external
        pure
        returns (address pool, uint256 shares, int24 positionBin)
    {
        return (address(1), 1, 0);
    }
}

contract GraduationAdapterRegistryTest {
    VmGraduationAdapterRegistry private constant VM =
        VmGraduationAdapterRegistry(address(uint160(uint256(keccak256("hevm cheat code")))));

    function _registry() private returns (GraduationAdapterRegistry value) {
        GraduationAdapterRegistry implementation = new GraduationAdapterRegistry();
        value = GraduationAdapterRegistry(
            address(
                new ERC1967Proxy(
                    address(implementation),
                    abi.encodeCall(GraduationAdapterRegistry.initialize, (address(this), address(this)))
                )
            )
        );
    }

    function testRegistrationIsAppendOnlyAndCanOnlyBeDisabled() external {
        GraduationAdapterRegistry registry = _registry();
        RegistryRouterMock router = new RegistryRouterMock();
        RegistryFactoryMock factory = new RegistryFactoryMock();
        RegistryAdapterMock adapter = new RegistryAdapterMock(address(factory));
        bytes32 reviewHash = keccak256("review:v1");

        bytes32 id = registry.register(address(adapter), address(router), reviewHash);
        GraduationAdapterRegistry.AdapterRecord memory record = registry.record(id);
        require(record.chainId == block.chainid, "chain");
        require(record.adapter == address(adapter), "adapter");
        require(record.factory == address(factory), "factory");
        require(record.router == address(router), "router");
        require(record.version == 1 && record.enabled, "version/status");
        require(record.reviewReferenceHash == reviewHash, "review");

        (bool duplicate,) = address(registry).call(
            abi.encodeCall(registry.register, (address(adapter), address(router), reviewHash))
        );
        require(!duplicate, "duplicate accepted");
        registry.setEnabled(id, false);
        require(!registry.isEnabled(address(adapter), 1), "still enabled");
    }

    function testRegistryDomainChangesAcrossChains() external {
        VM.chainId(998);
        GraduationAdapterRegistry testnetRegistry = _registry();
        VM.chainId(999);
        GraduationAdapterRegistry mainnetRegistry = _registry();
        address adapter = address(0x1234);
        require(
            testnetRegistry.recordId(adapter, 1) != mainnetRegistry.recordId(adapter, 1),
            "cross-chain collision"
        );
    }
}

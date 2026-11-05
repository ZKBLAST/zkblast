// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";
import { DbcTypes } from "../src/dbc/DbcTypes.sol";
import { GraduationAdapterRegistry } from "../src/dbc/GraduationAdapterRegistry.sol";
import { IGraduationAdapter } from "../src/dbc/IGraduationAdapter.sol";
import { IStockQuoteAssetRegistry } from "../src/stock/IStockQuoteAssetRegistry.sol";
import { StockQuoteAssetRegistry } from "../src/stock/StockQuoteAssetRegistry.sol";
import { StockQuoteDestinationRegistry } from "../src/stock/StockQuoteDestinationRegistry.sol";

contract DestinationTokenMock {
    uint8 public immutable decimals = 18;
}
contract DestinationFeedMock { }
contract DestinationFactoryMock { }
contract DestinationRouterMock { }

contract DestinationAdapterMock is IGraduationAdapter {
    address private immutable _factory;

    constructor(address factory_) {
        _factory = factory_;
    }

    function migrationMode() external pure returns (DbcTypes.MigrationMode) { return DbcTypes.MigrationMode.DAMM; }
    function adapterVersion() external pure returns (uint32) { return 1; }
    function factory() external view returns (address) { return _factory; }
    function configurationHash() external view returns (bytes32) {
        return keccak256(abi.encode(uint32(1), DbcTypes.MigrationMode.DAMM, _factory));
    }
    function migrate(Migration calldata) external pure returns (address, uint256, int24) {
        return (address(1), 1, 0);
    }
}

contract DestinationDlmmAdapterMock is IGraduationAdapter {
    address private immutable _factory;
    constructor(address factory_) { _factory = factory_; }
    function migrationMode() external pure returns (DbcTypes.MigrationMode) { return DbcTypes.MigrationMode.DLMM; }
    function adapterVersion() external pure returns (uint32) { return 1; }
    function factory() external view returns (address) { return _factory; }
    function configurationHash() external view returns (bytes32) {
        return keccak256(abi.encode(uint32(1), DbcTypes.MigrationMode.DLMM, _factory));
    }
    function migrate(Migration calldata) external pure returns (address, uint256, int24) {
        return (address(1), 1, 0);
    }
}

contract StockQuoteDestinationRegistryTest {
    struct Fixture {
        StockQuoteAssetRegistry assets;
        GraduationAdapterRegistry adapters;
        StockQuoteDestinationRegistry destinations;
        DestinationTokenMock token;
        DestinationAdapterMock damm;
        DestinationDlmmAdapterMock dlmm;
    }

    function _fixture() private returns (Fixture memory f) {
        f.assets = StockQuoteAssetRegistry(address(new ERC1967Proxy(
            address(new StockQuoteAssetRegistry()),
            abi.encodeCall(StockQuoteAssetRegistry.initialize, (address(this), address(this)))
        )));
        f.adapters = GraduationAdapterRegistry(address(new ERC1967Proxy(
            address(new GraduationAdapterRegistry()),
            abi.encodeCall(GraduationAdapterRegistry.initialize, (address(this), address(this)))
        )));
        f.destinations = StockQuoteDestinationRegistry(address(new ERC1967Proxy(
            address(new StockQuoteDestinationRegistry()),
            abi.encodeCall(StockQuoteDestinationRegistry.initialize, (
                address(this), address(this), f.assets, f.adapters
            ))
        )));
        f.token = new DestinationTokenMock();
        DestinationFeedMock feed = new DestinationFeedMock();
        f.assets.list(address(f.token), IStockQuoteAssetRegistry.QuoteAssetConfig({
            issuerAssetId: keccak256("issuer:MSFT"),
            priceFeed: address(feed),
            maxLaunchQuoteExposure: 10e18,
            maxPoolQuoteExposure: 20e18,
            maxOracleAge: 1 hours,
            maxOracleDeviationBps: 100,
            tokenDecimals: 18,
            enabled: true,
            quoteTradingEnabled: true,
            graduationEnabled: true
        }));
        DestinationFactoryMock factory = new DestinationFactoryMock();
        DestinationRouterMock router = new DestinationRouterMock();
        f.damm = new DestinationAdapterMock(address(factory));
        f.dlmm = new DestinationDlmmAdapterMock(address(factory));
        f.adapters.register(address(f.damm), address(router), keccak256("damm-review"));
        f.adapters.register(address(f.dlmm), address(router), keccak256("dlmm-review"));
    }

    function testDammAndDlmmAreAcceptedIndependently() external {
        Fixture memory f = _fixture();
        bytes32 dammId = f.destinations.register(
            address(f.token), address(f.damm), keccak256("damm-stock-review")
        );
        bytes32 dlmmId = f.destinations.register(
            address(f.token), address(f.dlmm), keccak256("dlmm-stock-review")
        );
        require(!f.destinations.isEnabled(address(f.token), DbcTypes.MigrationMode.DAMM), "early DAMM");
        require(!f.destinations.isEnabled(address(f.token), DbcTypes.MigrationMode.DLMM), "early DLMM");

        f.destinations.accept(dammId, keccak256("funded-damm-receipt"));
        require(f.destinations.isEnabled(address(f.token), DbcTypes.MigrationMode.DAMM), "DAMM disabled");
        require(!f.destinations.isEnabled(address(f.token), DbcTypes.MigrationMode.DLMM), "DLMM leaked");

        f.destinations.accept(dlmmId, keccak256("funded-dlmm-receipt"));
        require(f.destinations.isEnabled(address(f.token), DbcTypes.MigrationMode.DLMM), "DLMM disabled");
        f.destinations.disable(dammId);
        require(!f.destinations.isEnabled(address(f.token), DbcTypes.MigrationMode.DAMM), "DAMM active");
        require(f.destinations.isEnabled(address(f.token), DbcTypes.MigrationMode.DLMM), "DLMM affected");
    }

    function testCannotRegisterWhenAssetGraduationIsDisabled() external {
        Fixture memory f = _fixture();
        IStockQuoteAssetRegistry.QuoteAssetConfig memory config = f.assets.quoteAssetConfig(address(f.token));
        config.graduationEnabled = false;
        f.assets.update(address(f.token), config);
        (bool ok,) = address(f.destinations).call(abi.encodeCall(
            f.destinations.register,
            (address(f.token), address(f.damm), keccak256("review"))
        ));
        require(!ok, "disabled asset accepted");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";
import { IStockQuoteAssetRegistry } from "../src/stock/IStockQuoteAssetRegistry.sol";
import { StockQuoteAssetRegistry } from "../src/stock/StockQuoteAssetRegistry.sol";

contract StockQuoteTokenMock {
    uint8 public immutable decimals;

    constructor(uint8 decimals_) {
        decimals = decimals_;
    }
}

contract StockQuoteFeedMock { }

contract StockQuoteRegistryActor {
    function list(
        StockQuoteAssetRegistry registry,
        address asset,
        IStockQuoteAssetRegistry.QuoteAssetConfig calldata config
    ) external {
        registry.list(asset, config);
    }
}

contract StockQuoteAssetRegistryTest {
    function _registry() private returns (StockQuoteAssetRegistry registry) {
        StockQuoteAssetRegistry implementation = new StockQuoteAssetRegistry();
        registry = StockQuoteAssetRegistry(
            address(
                new ERC1967Proxy(
                    address(implementation),
                    abi.encodeCall(
                        StockQuoteAssetRegistry.initialize, (address(this), address(this))
                    )
                )
            )
        );
    }

    function _config(address feed)
        private
        pure
        returns (IStockQuoteAssetRegistry.QuoteAssetConfig memory config)
    {
        config = IStockQuoteAssetRegistry.QuoteAssetConfig({
            enabled: true,
            quoteTradingEnabled: true,
            graduationEnabled: false,
            priceFeed: feed,
            tokenDecimals: 18,
            maxOracleAge: 1 hours,
            maxOracleDeviationBps: 500,
            maxLaunchQuoteExposure: 1 ether,
            maxPoolQuoteExposure: 10 ether,
            issuerAssetId: keccak256("robinhood:AAPL")
        });
    }

    function testListsByAddressAndPreservesDisabledRecord() external {
        StockQuoteAssetRegistry registry = _registry();
        StockQuoteTokenMock token = new StockQuoteTokenMock(18);
        StockQuoteFeedMock feed = new StockQuoteFeedMock();
        IStockQuoteAssetRegistry.QuoteAssetConfig memory config = _config(address(feed));

        registry.list(address(token), config);
        StockQuoteAssetRegistry.AssetRecord memory listed = registry.assetRecord(address(token));
        require(listed.version == 1 && listed.config.quoteTradingEnabled, "not listed");
        require(registry.registryChainId() == block.chainid, "wrong chain domain");

        registry.disable(address(token));
        StockQuoteAssetRegistry.AssetRecord memory disabled = registry.assetRecord(address(token));
        require(disabled.version == 2, "version not advanced");
        require(!disabled.config.enabled, "still enabled");
        require(disabled.config.issuerAssetId == config.issuerAssetId, "identity lost");

        (bool trading,) =
            address(registry).call(abi.encodeCall(registry.requireTradingEnabled, (address(token))));
        require(!trading, "disabled trading accepted");
    }

    function testRejectsWrongDecimalsAndUnauthorizedListing() external {
        StockQuoteAssetRegistry registry = _registry();
        StockQuoteTokenMock token = new StockQuoteTokenMock(6);
        StockQuoteFeedMock feed = new StockQuoteFeedMock();
        IStockQuoteAssetRegistry.QuoteAssetConfig memory config = _config(address(feed));

        (bool decimalsAccepted,) =
            address(registry).call(abi.encodeCall(registry.list, (address(token), config)));
        require(!decimalsAccepted, "wrong decimals accepted");

        config.tokenDecimals = 6;
        StockQuoteRegistryActor actor = new StockQuoteRegistryActor();
        (bool unauthorized,) =
            address(actor).call(abi.encodeCall(actor.list, (registry, address(token), config)));
        require(!unauthorized, "unauthorized listing accepted");
    }

    function testCapabilitiesRequireExplicitEnablement() external {
        StockQuoteAssetRegistry registry = _registry();
        StockQuoteTokenMock token = new StockQuoteTokenMock(18);
        StockQuoteFeedMock feed = new StockQuoteFeedMock();
        IStockQuoteAssetRegistry.QuoteAssetConfig memory config = _config(address(feed));
        registry.list(address(token), config);

        (bool graduation,) = address(registry)
            .call(abi.encodeCall(registry.requireGraduationEnabled, (address(token))));
        require(!graduation, "graduation enabled implicitly");

        config.graduationEnabled = true;
        registry.update(address(token), config);
        IStockQuoteAssetRegistry.QuoteAssetConfig memory enabled =
            registry.requireGraduationEnabled(address(token));
        require(enabled.graduationEnabled, "graduation not enabled");
    }
}

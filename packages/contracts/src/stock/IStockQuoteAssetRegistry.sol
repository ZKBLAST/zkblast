// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IStockQuoteAssetRegistry {
    struct QuoteAssetConfig {
        bool enabled;
        bool quoteTradingEnabled;
        bool graduationEnabled;
        address priceFeed;
        uint8 tokenDecimals;
        uint32 maxOracleAge;
        uint16 maxOracleDeviationBps;
        uint128 maxLaunchQuoteExposure;
        uint128 maxPoolQuoteExposure;
        bytes32 issuerAssetId;
    }

    function registryChainId() external view returns (uint256);

    function quoteAssetConfig(address asset) external view returns (QuoteAssetConfig memory);

    function assetVersion(address asset) external view returns (uint32);

    function configurationHash(QuoteAssetConfig memory config) external pure returns (bytes32);

    function requireTradingEnabled(address asset) external view returns (QuoteAssetConfig memory);

    function requireGraduationEnabled(address asset) external view returns (QuoteAssetConfig memory);
}

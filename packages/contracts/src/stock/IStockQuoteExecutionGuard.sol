// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IStockQuoteExecutionGuard {
    function validateCreate(address quoteAsset) external view returns (bytes32 policyIdentity);

    function validateBuy(address quoteAsset, uint256 quoteAmountRaw)
        external
        view
        returns (bytes32 policyIdentity);

    function validateSell(address quoteAsset) external view returns (bytes32 policyIdentity);

    function validateGraduate(address quoteAsset, uint256 quoteAmountRaw)
        external
        view
        returns (bytes32 policyIdentity);

    function policyIdentity(address quoteAsset) external view returns (bytes32);
}

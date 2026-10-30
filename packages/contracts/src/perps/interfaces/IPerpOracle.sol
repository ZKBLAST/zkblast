// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IPerpOracle {
    struct Price {
        uint256 value;
        uint64 updatedAt;
    }

    /// @notice Returns an independently sourced USD price normalized to 18 decimals.
    function latestPrice(bytes32 oracleId) external view returns (Price memory price);
}

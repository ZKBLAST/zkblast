// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DbcTypes } from "./DbcTypes.sol";

interface IGraduationAdapter {
    struct Migration {
        address baseToken;
        address quoteToken;
        uint8 baseDecimals;
        uint8 quoteDecimals;
        uint24 feePips;
        uint16 toleranceBps;
        uint256 baseAmount;
        uint256 quoteAmount;
        uint256 expectedPriceX18;
        uint256 minimumShares;
        address lpRecipient;
        uint256 deadline;
    }

    function migrationMode() external pure returns (DbcTypes.MigrationMode);
    function adapterVersion() external pure returns (uint32);
    function factory() external view returns (address);
    function configurationHash() external view returns (bytes32);
    function migrate(Migration calldata migration)
        external
        returns (address pool, uint256 shares, int24 positionBin);
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DbcTypes } from "./DbcTypes.sol";

/// @notice Explicit bounded memory-to-storage copy for nested fixed-size curve data.
library DbcConfigStorage {
    function write(DbcTypes.TemplateConfig storage target, DbcTypes.TemplateConfig memory source)
        internal
    {
        target.quoteToken = source.quoteToken;
        target.protocolFeeRecipient = source.protocolFeeRecipient;
        target.partnerFeeRecipient = source.partnerFeeRecipient;
        target.protocolLpRecipient = source.protocolLpRecipient;
        target.quoteDecimals = source.quoteDecimals;
        target.baseDecimals = source.baseDecimals;
        target.migrationMode = source.migrationMode;
        target.destinationFeePips = source.destinationFeePips;
        target.terminalPriceToleranceBps = source.terminalPriceToleranceBps;
        target.totalSupplyRaw = source.totalSupplyRaw;
        target.baseInventoryRaw = source.baseInventoryRaw;
        target.graduationThresholdRaw = source.graduationThresholdRaw;
        target.minimumDestinationShares = source.minimumDestinationShares;
        target.curve.segmentCount = source.curve.segmentCount;
        for (uint256 index; index < source.curve.segmentCount; ++index) {
            target.curve.segments[index] = source.curve.segments[index];
        }
        target.fees = source.fees;
        target.lp = source.lp;
    }
}

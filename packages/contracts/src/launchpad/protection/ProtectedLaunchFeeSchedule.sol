// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { FullMath } from "../../math/FullMath.sol";

/// @notice Deterministic buy-only fee schedule for a Protected launch window.
library ProtectedLaunchFeeSchedule {
    error InvalidFeeSchedule();

    uint16 internal constant BPS = 10_000;

    function feeBpsAt(
        uint256 currentBlock,
        uint64 startBlock,
        uint32 protectionBlocks,
        uint16 initialFeeBps,
        uint16 baseFeeBps
    ) internal pure returns (uint16) {
        if (protectionBlocks == 0 || initialFeeBps > BPS || baseFeeBps > initialFeeBps) revert InvalidFeeSchedule();
        if (currentBlock <= startBlock) return initialFeeBps;
        uint256 elapsed = currentBlock - startBlock;
        if (elapsed >= protectionBlocks) return baseFeeBps;

        uint256 decay = uint256(initialFeeBps - baseFeeBps) * elapsed / protectionBlocks;
        return uint16(uint256(initialFeeBps) - decay);
    }

    function feeOnGross(uint256 grossAmount, uint16 feeBps) internal pure returns (uint256) {
        if (feeBps > BPS) revert InvalidFeeSchedule();
        return FullMath.mulDiv(grossAmount, feeBps, BPS);
    }

    function netFromGross(uint256 grossAmount, uint16 feeBps) internal pure returns (uint256) {
        return grossAmount - feeOnGross(grossAmount, feeBps);
    }
}

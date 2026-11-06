// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

library NonEmptyBinBitmap {
    int24 internal constant MIN_BIN = -10_000;
    int24 internal constant MAX_BIN = 10_000;
    uint256 private constant BIN_OFFSET = 10_000;

    error InvalidBin();

    function set(mapping(uint256 word => uint256 bits) storage bitmap, int24 binId) internal {
        (uint256 word, uint256 bit) = locate(binId);
        bitmap[word] |= uint256(1) << bit;
    }

    function clear(mapping(uint256 word => uint256 bits) storage bitmap, int24 binId) internal {
        (uint256 word, uint256 bit) = locate(binId);
        bitmap[word] &= ~(uint256(1) << bit);
    }

    function contains(mapping(uint256 word => uint256 bits) storage bitmap, int24 binId)
        internal
        view
        returns (bool)
    {
        (uint256 word, uint256 bit) = locate(binId);
        return bitmap[word] & (uint256(1) << bit) != 0;
    }

    function next(
        mapping(uint256 word => uint256 bits) storage bitmap,
        int24 fromBin,
        bool increasing
    ) internal view returns (bool found, int24 binId) {
        if (fromBin < MIN_BIN || fromBin > MAX_BIN) revert InvalidBin();
        uint256 cursor = uint256(int256(fromBin) + int256(BIN_OFFSET));
        if (increasing) {
            for (uint256 candidate = cursor + 1; candidate <= uint256(int256(MAX_BIN) + int256(BIN_OFFSET)); ++candidate) {
                uint256 word = candidate >> 8;
                uint256 bit = candidate & 255;
                uint256 available = bitmap[word] & (type(uint256).max << bit);
                if (available == 0) {
                    candidate = ((word + 1) << 8) - 1;
                    continue;
                }
                uint256 nextBit = _leastSignificantBit(available);
                return (true, int24(int256((word << 8) + nextBit) - int256(BIN_OFFSET)));
            }
            return (false, 0);
        }
        for (;;) {
            uint256 word = cursor >> 8;
            uint256 bit = cursor & 255;
            uint256 mask = bit == 0 ? 0 : (uint256(1) << bit) - 1;
            uint256 available = bitmap[word] & mask;
            if (available != 0) {
                uint256 previousBit = _mostSignificantBit(available);
                return (true, int24(int256((word << 8) + previousBit) - int256(BIN_OFFSET)));
            }
            if (word == 0) return (false, 0);
            cursor = word << 8;
        }
    }

    function locate(int24 binId) private pure returns (uint256 word, uint256 bit) {
        if (binId < MIN_BIN || binId > MAX_BIN) revert InvalidBin();
        uint256 normalized = uint256(int256(binId) + int256(BIN_OFFSET));
        return (normalized >> 8, normalized & 255);
    }

    function _leastSignificantBit(uint256 value) private pure returns (uint256 index) {
        while (value & 1 == 0) {
            value >>= 1;
            ++index;
        }
    }

    function _mostSignificantBit(uint256 value) private pure returns (uint256 index) {
        while (value > 1) {
            value >>= 1;
            ++index;
        }
    }
}

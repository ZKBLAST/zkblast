// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

enum PoolModel {
    DAMM,
    DLMM
}

struct PoolKey {
    address token0;
    address token1;
    PoolModel model;
    uint24 feePips;
    uint16 binStepBps;
}

library PoolKeyLib {
    error IdenticalTokens();
    error InvalidToken();

    function normalize(
        address tokenA,
        address tokenB,
        PoolModel model,
        uint24 feePips,
        uint16 binStepBps
    ) internal pure returns (PoolKey memory key) {
        if (tokenA == address(0) || tokenB == address(0)) revert InvalidToken();
        if (tokenA == tokenB) revert IdenticalTokens();
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        key = PoolKey(token0, token1, model, feePips, binStepBps);
    }

    function id(PoolKey memory key) internal pure returns (bytes32) {
        return keccak256(abi.encode(key));
    }
}

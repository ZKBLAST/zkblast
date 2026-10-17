// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IFieldHasher {
    function hashMerkleNode(uint256 level, bytes32 left, bytes32 right)
        external
        view
        returns (bytes32);
}

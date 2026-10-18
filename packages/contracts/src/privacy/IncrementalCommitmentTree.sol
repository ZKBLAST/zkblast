// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IFieldHasher } from "../interfaces/IFieldHasher.sol";

library IncrementalCommitmentTree {
    error InvalidCommitment();
    error TreeAlreadyInitialized();
    error TreeNotInitialized();
    error TreeFull();

    uint256 internal constant DEPTH = 32;
    uint256 private constant BN254_SCALAR_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    struct Tree {
        bytes32[DEPTH] zeroes;
        bytes32[DEPTH] filledSubtrees;
        bytes32 root;
        uint64 nextLeafIndex;
        bool initialized;
    }

    function initialize(Tree storage tree, IFieldHasher hasher, bytes32 emptyLeaf) internal {
        if (tree.initialized) revert TreeAlreadyInitialized();
        _requireField(emptyLeaf);
        bytes32 current = emptyLeaf;
        for (uint256 level = 0; level < DEPTH; ++level) {
            tree.zeroes[level] = current;
            tree.filledSubtrees[level] = current;
            current = hasher.hashMerkleNode(level, current, current);
            _requireField(current);
        }
        tree.root = current;
        tree.initialized = true;
    }

    function insert(Tree storage tree, IFieldHasher hasher, bytes32 commitment)
        internal
        returns (uint32 leafIndex, bytes32 newRoot)
    {
        if (!tree.initialized) revert TreeNotInitialized();
        _requireField(commitment);
        if (tree.nextLeafIndex >= uint64(uint256(1) << DEPTH)) revert TreeFull();
        leafIndex = uint32(tree.nextLeafIndex);

        uint256 pathIndex = leafIndex;
        bytes32 current = commitment;
        for (uint256 level = 0; level < DEPTH; ++level) {
            if (pathIndex & 1 == 0) {
                tree.filledSubtrees[level] = current;
                current = hasher.hashMerkleNode(level, current, tree.zeroes[level]);
            } else {
                current = hasher.hashMerkleNode(level, tree.filledSubtrees[level], current);
            }
            _requireField(current);
            pathIndex >>= 1;
        }

        tree.root = current;
        unchecked {
            tree.nextLeafIndex = uint64(leafIndex) + 1;
        }
        newRoot = current;
    }

    function _requireField(bytes32 value) private pure {
        if (value == bytes32(0) || uint256(value) >= BN254_SCALAR_FIELD) {
            revert InvalidCommitment();
        }
    }
}

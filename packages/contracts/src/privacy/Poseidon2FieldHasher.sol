// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Poseidon2T4_BN254 } from "poseidon2-solidity/Poseidon2T4_BN254.sol";

import { IFieldHasher } from "../interfaces/IFieldHasher.sol";

/// @notice Circuit-compatible Poseidon2 Merkle-node compression for withdrawal circuit v1.
/// @dev The domain and input ordering must remain identical to MerkleNodeV1 in poseidon2.circom.
contract Poseidon2FieldHasher is IFieldHasher {
    uint256 public constant MERKLE_DOMAIN_V1 =
        12549531065135229307630222961034828520083803988054572781452577856409828989647;

    function hashMerkleNode(uint256 level, bytes32 left, bytes32 right)
        external
        pure
        returns (bytes32)
    {
        return bytes32(
            Poseidon2T4_BN254.compress(MERKLE_DOMAIN_V1, level, uint256(left), uint256(right))
        );
    }
}

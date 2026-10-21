// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Poseidon2T4_BN254 } from "poseidon2-solidity/Poseidon2T4_BN254.sol";
import { IFieldHasher } from "../../interfaces/IFieldHasher.sol";

interface IPrivateFieldHasherV2 is IFieldHasher {
    function MERKLE_DOMAIN_V2() external view returns (uint256);
}

contract Poseidon2FieldHasherV2 is IPrivateFieldHasherV2 {
    uint256 public constant MERKLE_DOMAIN_V2 = 2002004;

    function hashMerkleNode(uint256 level, bytes32 left, bytes32 right)
        external
        pure
        returns (bytes32)
    {
        return bytes32(
            Poseidon2T4_BN254.compress(MERKLE_DOMAIN_V2, level, uint256(left), uint256(right))
        );
    }
}

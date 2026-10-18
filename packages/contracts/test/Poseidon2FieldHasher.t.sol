// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Poseidon2FieldHasher } from "../src/privacy/Poseidon2FieldHasher.sol";

contract Poseidon2FieldHasherTest {
    uint256 private constant EXPECTED_COMMITMENT =
        8353182850804981539055168078686044992280121865775248785434174199080612463277;
    uint256 private constant EXPECTED_ROOT =
        19017397233104865673889823936942450712709747250411938244881798038029935587977;

    function testMatchesFrozenCircuitMerkleVectorV1() external {
        Poseidon2FieldHasher hasher = new Poseidon2FieldHasher();
        bytes32 node = bytes32(EXPECTED_COMMITMENT);

        for (uint256 level = 0; level < 32; ++level) {
            bytes32 sibling = bytes32(level + 1);
            node = level % 2 == 0
                ? hasher.hashMerkleNode(level, sibling, node)
                : hasher.hashMerkleNode(level, node, sibling);
        }

        require(uint256(node) == EXPECTED_ROOT, "circuit/contract Poseidon2 mismatch");
    }
}

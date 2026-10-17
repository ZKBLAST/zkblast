// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IZkProofVerifier } from "../interfaces/IZkProofVerifier.sol";
import { ShieldedStateRegistry } from "./ShieldedStateRegistry.sol";
import { VerifierRegistry } from "./VerifierRegistry.sol";

contract WithdrawalVerifierAdapter {
    error InvalidPublicInput();
    error InactiveVerifier();
    error ProofVerificationFailed();

    bytes32 public constant CIRCUIT_ID = keccak256("ZKBLAST_WITHDRAW");
    uint256 public constant SCHEMA_VERSION = 1;
    uint256 public constant WITHDRAW_ACTION = 1;
    uint256 private constant BN254_SCALAR_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    VerifierRegistry public immutable verifierRegistry;
    ShieldedStateRegistry public immutable stateRegistry;

    constructor(VerifierRegistry verifierRegistry_, ShieldedStateRegistry stateRegistry_) {
        if (address(verifierRegistry_) == address(0) || address(stateRegistry_) == address(0)) {
            revert InvalidPublicInput();
        }
        verifierRegistry = verifierRegistry_;
        stateRegistry = stateRegistry_;
    }

    function verifyAndConsume(bytes calldata proof, uint256[13] calldata inputs, address relayer)
        external
        returns (bytes32 nullifier)
    {
        _validateContext(inputs, relayer);
        uint64 circuitVersion = uint64(inputs[4]);
        VerifierRegistry.VerifierRecord memory record =
            verifierRegistry.get(CIRCUIT_ID, circuitVersion);
        if (!record.active) revert InactiveVerifier();
        if (!IZkProofVerifier(record.verifier).verify(proof, inputs)) {
            revert ProofVerificationFailed();
        }

        nullifier = bytes32(inputs[6]);
        stateRegistry.consumeNullifierFor(msg.sender, circuitVersion, bytes32(inputs[5]), nullifier);
    }

    function _validateContext(uint256[13] calldata inputs, address relayer) private view {
        for (uint256 index = 0; index < inputs.length; ++index) {
            if (inputs[index] >= BN254_SCALAR_FIELD) revert InvalidPublicInput();
        }
        if (
            inputs[0] != SCHEMA_VERSION || inputs[1] != WITHDRAW_ACTION
                || inputs[2] != block.chainid || inputs[3] != uint160(msg.sender) || inputs[4] == 0
                || inputs[5] == 0 || inputs[6] == 0 || inputs[7] == 0 || inputs[8] == 0
                || inputs[9] == 0 || inputs[12] < block.timestamp || inputs[11] > inputs[8]
        ) revert InvalidPublicInput();
        if (
            inputs[2] > type(uint64).max || inputs[3] > type(uint160).max
                || inputs[4] > type(uint64).max || inputs[7] > type(uint160).max
                || inputs[8] > type(uint128).max || inputs[9] > type(uint160).max
                || inputs[10] > type(uint160).max || inputs[11] > type(uint128).max
                || inputs[12] > type(uint64).max
        ) revert InvalidPublicInput();
        if (relayer == address(0) || inputs[10] != uint160(relayer)) revert InvalidPublicInput();
    }
}

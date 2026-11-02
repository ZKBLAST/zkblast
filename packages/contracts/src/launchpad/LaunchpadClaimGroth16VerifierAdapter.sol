// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ILaunchpadClaimVerifier } from "./LaunchpadProofClaimAdapter.sol";

interface ILaunchpadClaimGroth16Verifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[15] calldata publicSignals
    ) external view returns (bool);
}

/// @notice Strict bytes-to-Groth16 bridge for the launchpad claim statement.
contract LaunchpadClaimGroth16VerifierAdapter is ILaunchpadClaimVerifier {
    error InvalidVerifier();
    error InvalidProofEncoding();

    uint256 private constant ENCODED_PROOF_LENGTH = 256;
    ILaunchpadClaimGroth16Verifier public immutable groth16Verifier;

    constructor(ILaunchpadClaimGroth16Verifier groth16Verifier_) {
        if (address(groth16Verifier_) == address(0)) revert InvalidVerifier();
        groth16Verifier = groth16Verifier_;
    }

    function verify(bytes calldata proof, uint256[15] calldata publicInputs)
        external
        view
        returns (bool)
    {
        if (proof.length != ENCODED_PROOF_LENGTH) revert InvalidProofEncoding();
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) =
            abi.decode(proof, (uint256[2], uint256[2][2], uint256[2]));
        return groth16Verifier.verifyProof(a, b, c, publicInputs);
    }
}

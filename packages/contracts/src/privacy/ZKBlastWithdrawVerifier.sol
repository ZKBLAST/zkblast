// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.26;

import { IZkProofVerifier } from "../interfaces/IZkProofVerifier.sol";
import { WithdrawGroth16Verifier } from "./WithdrawGroth16Verifier.sol";

/// @notice ZKBLAST withdraw-v1 verifier with the protocol's versioned verifier interface.
/// @dev `proof` is ABI-encoded as (uint256[2] a, uint256[2][2] b, uint256[2] c).
contract ZKBlastWithdrawVerifier is IZkProofVerifier, WithdrawGroth16Verifier {
    uint256 public constant CIRCUIT_VERSION = 1;

    function verify(bytes calldata proof, uint256[13] calldata publicInputs)
        external
        view
        returns (bool)
    {
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) =
            abi.decode(proof, (uint256[2], uint256[2][2], uint256[2]));
        return this.verifyProof(a, b, c, publicInputs);
    }
}

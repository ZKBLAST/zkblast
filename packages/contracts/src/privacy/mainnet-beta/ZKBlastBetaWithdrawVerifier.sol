// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.26;

import { IZkProofVerifier } from "../../interfaces/IZkProofVerifier.sol";
import { ZKBlastBetaGroth16Verifier } from "./ZKBlastBetaGroth16Verifier.sol";

/// @notice Experimental single-operator setup, not independently audited.
/// @dev Immutable versioned verifier. Never substitute the testnet verification key.
contract ZKBlastBetaWithdrawVerifier is IZkProofVerifier, ZKBlastBetaGroth16Verifier {
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

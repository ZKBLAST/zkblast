// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IZkProofVerifier {
    function verify(bytes calldata proof, uint256[13] calldata publicInputs)
        external
        view
        returns (bool);
}

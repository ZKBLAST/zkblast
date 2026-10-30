// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IPrivatePerpVerifier {
    function verify(bytes calldata proof, uint256[] calldata publicInputs)
        external
        view
        returns (bool);
}

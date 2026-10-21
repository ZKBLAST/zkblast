// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IPrivateActionVerifierV2 {
    function verify(bytes calldata proof, uint256[32] calldata inputs) external view returns (bool);
}

interface IPrivateFundVerifierV2 {
    function verify(bytes calldata proof, uint256[11] calldata inputs) external view returns (bool);
}

interface IActionGroth16V2 {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[32] calldata inputs
    ) external view returns (bool);
}

interface IFundGroth16V2 {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[11] calldata inputs
    ) external view returns (bool);
}

/// @notice ABI adapters for freshly generated v2 Groth16 verifiers.
/// @dev Addresses must be pinned to reviewed release artifacts at deployment.
contract PrivateActionVerifierV2 is IPrivateActionVerifierV2 {
    IActionGroth16V2 public immutable verifier;

    constructor(IActionGroth16V2 verifier_) {
        require(address(verifier_).code.length != 0, "invalid verifier");
        verifier = verifier_;
    }

    function verify(bytes calldata proof, uint256[32] calldata inputs)
        external
        view
        returns (bool)
    {
        if (proof.length != 256) return false;
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) =
            abi.decode(proof, (uint256[2], uint256[2][2], uint256[2]));
        try verifier.verifyProof(a, b, c, inputs) returns (bool accepted) {
            return accepted;
        } catch {
            return false;
        }
    }
}

contract PrivateFundVerifierV2 is IPrivateFundVerifierV2 {
    IFundGroth16V2 public immutable verifier;

    constructor(IFundGroth16V2 verifier_) {
        require(address(verifier_).code.length != 0, "invalid verifier");
        verifier = verifier_;
    }

    function verify(bytes calldata proof, uint256[11] calldata inputs)
        external
        view
        returns (bool)
    {
        if (proof.length != 256) return false;
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) =
            abi.decode(proof, (uint256[2], uint256[2][2], uint256[2]));
        try verifier.verifyProof(a, b, c, inputs) returns (bool accepted) {
            return accepted;
        } catch {
            return false;
        }
    }
}

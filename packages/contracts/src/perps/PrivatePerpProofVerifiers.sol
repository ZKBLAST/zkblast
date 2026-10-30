// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IPrivatePerpVerifier } from "./interfaces/IPrivatePerpVerifier.sol";

interface IPerpOpenGroth16Verifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[21] calldata inputs
    ) external view returns (bool);
}

interface IPerpCloseGroth16Verifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[17] calldata inputs
    ) external view returns (bool);
}

interface IPerpModifyGroth16Verifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[19] calldata inputs
    ) external view returns (bool);
}

interface IPerpClaimGroth16Verifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[16] calldata inputs
    ) external view returns (bool);
}

abstract contract PrivatePerpVerifierBase {
    error InvalidGeneratedVerifier();

    address public immutable generatedVerifier;

    constructor(address generatedVerifier_) {
        if (generatedVerifier_.code.length == 0) revert InvalidGeneratedVerifier();
        generatedVerifier = generatedVerifier_;
    }

    function _proof(bytes calldata proof)
        internal
        pure
        returns (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c)
    {
        if (proof.length != 256) return (a, b, c);
        return abi.decode(proof, (uint256[2], uint256[2][2], uint256[2]));
    }
}

contract PrivatePerpOpenVerifier is PrivatePerpVerifierBase, IPrivatePerpVerifier {
    constructor(address verifier) PrivatePerpVerifierBase(verifier) { }

    function verify(bytes calldata proof, uint256[] calldata publicInputs)
        external view returns (bool)
    {
        if (proof.length != 256 || publicInputs.length != 21) return false;
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = _proof(proof);
        uint256[21] memory inputs;
        for (uint256 i; i < 21; ++i) inputs[i] = publicInputs[i];
        try IPerpOpenGroth16Verifier(generatedVerifier).verifyProof(a, b, c, inputs) returns (bool ok) {
            return ok;
        } catch { return false; }
    }
}

contract PrivatePerpCloseVerifier is PrivatePerpVerifierBase, IPrivatePerpVerifier {
    constructor(address verifier) PrivatePerpVerifierBase(verifier) { }

    function verify(bytes calldata proof, uint256[] calldata publicInputs)
        external view returns (bool)
    {
        if (proof.length != 256 || publicInputs.length != 17) return false;
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = _proof(proof);
        uint256[17] memory inputs;
        for (uint256 i; i < 17; ++i) inputs[i] = publicInputs[i];
        try IPerpCloseGroth16Verifier(generatedVerifier).verifyProof(a, b, c, inputs) returns (bool ok) {
            return ok;
        } catch { return false; }
    }
}

contract PrivatePerpModifyVerifier is PrivatePerpVerifierBase, IPrivatePerpVerifier {
    constructor(address verifier) PrivatePerpVerifierBase(verifier) { }

    function verify(bytes calldata proof, uint256[] calldata publicInputs)
        external view returns (bool)
    {
        if (proof.length != 256 || publicInputs.length != 19) return false;
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = _proof(proof);
        uint256[19] memory inputs;
        for (uint256 i; i < 19; ++i) inputs[i] = publicInputs[i];
        try IPerpModifyGroth16Verifier(generatedVerifier).verifyProof(a, b, c, inputs) returns (bool ok) {
            return ok;
        } catch { return false; }
    }
}

contract PrivatePerpClaimVerifier is PrivatePerpVerifierBase, IPrivatePerpVerifier {
    constructor(address verifier) PrivatePerpVerifierBase(verifier) { }

    function verify(bytes calldata proof, uint256[] calldata publicInputs)
        external view returns (bool)
    {
        if (proof.length != 256 || publicInputs.length != 16) return false;
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = _proof(proof);
        uint256[16] memory inputs;
        for (uint256 i; i < 16; ++i) inputs[i] = publicInputs[i];
        try IPerpClaimGroth16Verifier(generatedVerifier).verifyProof(a, b, c, inputs) returns (bool ok) {
            return ok;
        } catch { return false; }
    }
}

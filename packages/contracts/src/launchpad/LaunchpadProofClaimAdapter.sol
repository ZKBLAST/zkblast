// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { RevenueSplitter } from "./RevenueSplitter.sol";

interface ILaunchpadClaimVerifier {
    function verify(bytes calldata proof, uint256[15] calldata publicInputs)
        external
        view
        returns (bool);
}

/// @notice Optional proof-of-authorization path for a public fee payout.
/// @dev The proof hides only the authorization secret. Recipient, asset, amount and tx remain public.
contract LaunchpadProofClaimAdapter {
    error AuthorizationUnavailable();
    error InvalidPublicInput();
    error NullifierAlreadySpent();
    error ProofVerificationFailed();

    uint256 public constant SCHEMA_VERSION = 1;
    uint256 public constant CLAIM_ACTION = 1;
    uint256 public constant VERIFIER_VERSION = 1;
    uint256 private constant BN254_SCALAR_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    RevenueSplitter public immutable revenueSplitter;
    ILaunchpadClaimVerifier public immutable verifier;
    mapping(bytes32 snapshotId => mapping(address recipient => bytes32 commitment))
        public authorizationCommitment;
    mapping(bytes32 nullifier => bool spent) public nullifierSpent;

    event AuthorizationCommitmentUpdated(
        bytes32 indexed snapshotId, address indexed recipient, bytes32 indexed commitment
    );
    event ProofClaimVerified(
        bytes32 indexed snapshotId,
        address indexed recipient,
        bytes32 indexed nullifier,
        uint256 amount,
        uint256 verifierVersion
    );

    constructor(RevenueSplitter revenueSplitter_, ILaunchpadClaimVerifier verifier_) {
        if (address(revenueSplitter_) == address(0) || address(verifier_) == address(0)) {
            revert InvalidPublicInput();
        }
        revenueSplitter = revenueSplitter_;
        verifier = verifier_;
    }

    function setAuthorizationCommitment(bytes32 snapshotId, bytes32 commitment) external {
        if (snapshotId == bytes32(0) || commitment == bytes32(0)) {
            revert InvalidPublicInput();
        }
        authorizationCommitment[snapshotId][msg.sender] = commitment;
        emit AuthorizationCommitmentUpdated(snapshotId, msg.sender, commitment);
    }

    function claimWithProof(bytes calldata proof, uint256[15] calldata inputs)
        external
        returns (uint256 amount)
    {
        bytes32 snapshotId = bytes32(inputs[7] | (inputs[8] << 128));
        address recipient = address(uint160(inputs[9]));
        bytes32 nullifier = bytes32(inputs[13]);
        _validate(inputs, snapshotId, recipient, nullifier);
        if (!verifier.verify(proof, inputs)) revert ProofVerificationFailed();
        nullifierSpent[nullifier] = true;
        amount = revenueSplitter.claimFor(snapshotId, recipient);
        if (amount > inputs[11]) revert InvalidPublicInput();
        emit ProofClaimVerified(snapshotId, recipient, nullifier, amount, VERIFIER_VERSION);
    }

    function _validate(
        uint256[15] calldata inputs,
        bytes32 snapshotId,
        address recipient,
        bytes32 nullifier
    ) private view {
        for (uint256 index; index < inputs.length; ++index) {
            if (inputs[index] >= BN254_SCALAR_FIELD) revert InvalidPublicInput();
        }
        RevenueSplitter.RegisteredSnapshot memory item = revenueSplitter.snapshot(snapshotId);
        if (
            inputs[0] != SCHEMA_VERSION || inputs[1] != CLAIM_ACTION
                || inputs[2] != block.chainid || inputs[3] != uint160(address(this))
                || inputs[4] != VERIFIER_VERSION || inputs[5] != item.launchpadId
                || inputs[6] != uint160(item.pool) || recipient == address(0)
                || inputs[10] != uint160(item.asset) || inputs[11] == 0
                || inputs[12] < block.timestamp || nullifier == bytes32(0)
                || inputs[14] == 0
        ) revert InvalidPublicInput();
        if (
            inputs[2] > type(uint64).max || inputs[3] > type(uint160).max
                || inputs[5] > type(uint128).max || inputs[6] > type(uint160).max
                || inputs[7] > type(uint128).max || inputs[8] > type(uint128).max
                || inputs[9] > type(uint160).max || inputs[10] > type(uint160).max
                || inputs[11] > type(uint128).max || inputs[12] > type(uint64).max
        ) revert InvalidPublicInput();
        if (nullifierSpent[nullifier]) revert NullifierAlreadySpent();
        if (authorizationCommitment[snapshotId][recipient] != bytes32(inputs[14])) {
            revert AuthorizationUnavailable();
        }
    }
}

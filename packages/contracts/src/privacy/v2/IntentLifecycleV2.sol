// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ReentrancyGuard } from "../../security/ReentrancyGuard.sol";

/// @notice Abstract atomic settlement/expiry state machine, never a custody deployment.
/// @dev A concrete implementation MUST verify reservation ownership, conservation
/// of BOTH settlement and refund outputs, root/verifier eligibility and context
/// before _reserve. Pool adapters and a v2 commitment tree are not supplied here.
abstract contract IntentLifecycleV2 is ReentrancyGuard {
    error InvalidReservation();
    error NullifierUnavailable();
    error InvalidIntentState();
    error IntentExpired();
    error RefundNotAvailable();
    error StatementMismatch();

    uint256 private constant FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 public constant MAX_INTENT_LIFETIME = 1 hours;

    enum Status {
        Unknown,
        Pending,
        Settled,
        Refunded
    }

    struct Reservation {
        bytes32 statementHash;
        uint64 deadline;
        bytes32[3] nullifiers;
        bytes32[3] settlementCommitments;
        bytes32[3] refundCommitments;
    }

    struct Intent {
        Status status;
        Reservation reservation;
    }

    mapping(bytes32 intentId => Intent) private _intents;
    // Never clear this mapping: original notes cannot revive after a refund.
    mapping(bytes32 nullifier => bytes32 intentId) public nullifierIntent;

    event IntentReserved(bytes32 indexed intentId, uint64 deadline);
    event IntentSettled(bytes32 indexed intentId);
    event IntentRefunded(bytes32 indexed intentId);

    function intentStatus(bytes32 intentId) external view returns (Status) {
        return _intents[intentId].status;
    }

    function reservation(bytes32 intentId) external view returns (Reservation memory) {
        return _intents[intentId].reservation;
    }

    /// @dev Only expose through a concrete, proof-verifying entrypoint. Zero slots
    /// are disabled. Context and refund amounts cannot be validated by this base.
    function _reserve(Reservation memory r) internal returns (bytes32 intentId) {
        if (
            r.statementHash == bytes32(0) || r.deadline <= block.timestamp
                || r.deadline > block.timestamp + MAX_INTENT_LIFETIME
        ) {
            revert InvalidReservation();
        }
        intentId = keccak256(abi.encode("ZKBLAST_INTENT_V2", block.chainid, address(this), r));
        if (_intents[intentId].status != Status.Unknown) revert InvalidIntentState();
        uint256 spends;
        uint256 outputs;
        uint256 refunds;
        for (uint256 i; i < 3; ++i) {
            _canonical(r.nullifiers[i]);
            _canonical(r.settlementCommitments[i]);
            _canonical(r.refundCommitments[i]);
            if (r.nullifiers[i] != bytes32(0)) {
                if (nullifierIntent[r.nullifiers[i]] != bytes32(0)) revert NullifierUnavailable();
                nullifierIntent[r.nullifiers[i]] = intentId;
                ++spends;
            }
            if (r.settlementCommitments[i] != bytes32(0)) ++outputs;
            if (r.refundCommitments[i] != bytes32(0)) ++refunds;
            for (uint256 j; j < i; ++j) {
                if (
                    (r.settlementCommitments[i] != bytes32(0)
                            && r.settlementCommitments[i] == r.settlementCommitments[j])
                        || (r.refundCommitments[i] != bytes32(0)
                            && r.refundCommitments[i] == r.refundCommitments[j])
                ) revert InvalidReservation();
            }
            for (uint256 j; j < 3; ++j) {
                if (
                    r.settlementCommitments[i] != bytes32(0)
                        && r.settlementCommitments[i] == r.refundCommitments[j]
                ) revert InvalidReservation();
            }
        }
        if (spends == 0 || outputs == 0 || refunds == 0) revert InvalidReservation();
        _intents[intentId] = Intent(Status.Pending, r);
        emit IntentReserved(intentId, r.deadline);
    }

    /// @notice Any executor may submit the bound statement before expiry.
    /// Reverting pool execution or note insertion rolls back the terminal state.
    function settle(bytes32 intentId, bytes calldata statement) external nonReentrant {
        _settle(intentId, statement);
    }

    /// @notice All submitted intents settle or the entire batch rolls back.
    function settleBatch(bytes32[] calldata intentIds, bytes[] calldata statements)
        external
        nonReentrant
    {
        if (intentIds.length == 0 || intentIds.length > 32 || intentIds.length != statements.length)
        {
            revert InvalidReservation();
        }
        for (uint256 i; i < intentIds.length; ++i) {
            _settle(intentIds[i], statements[i]);
        }
    }

    function _settle(bytes32 intentId, bytes calldata statement) private {
        Intent storage intent = _intents[intentId];
        if (intent.status != Status.Pending) revert InvalidIntentState();
        if (block.timestamp > intent.reservation.deadline) revert IntentExpired();
        if (keccak256(statement) != intent.reservation.statementHash) revert StatementMismatch();
        intent.status = Status.Settled;
        _executeAtomic(intentId, statement);
        _appendNotes(intent.reservation.settlementCommitments);
        emit IntentSettled(intentId);
    }

    /// @notice Anyone can restore the already proof-bound refund notes after
    /// expiry; no solver signature or administrator approval is needed.
    function refund(bytes32 intentId) external nonReentrant {
        Intent storage intent = _intents[intentId];
        if (intent.status != Status.Pending) revert InvalidIntentState();
        if (block.timestamp <= intent.reservation.deadline) revert RefundNotAvailable();
        intent.status = Status.Refunded;
        _appendNotes(intent.reservation.refundCommitments);
        emit IntentRefunded(intentId);
    }

    function _canonical(bytes32 value) private pure {
        if (uint256(value) >= FIELD) revert InvalidReservation();
    }

    function _executeAtomic(bytes32 intentId, bytes calldata statement) internal virtual;
    function _appendNotes(bytes32[3] memory commitments) internal virtual;
}

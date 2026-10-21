// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { PoolRegistry } from "../../core/PoolRegistry.sol";
import { TokenTransfer } from "../../libraries/TokenTransfer.sol";
import { IntentLifecycleV2 } from "./IntentLifecycleV2.sol";
import { SettlementTermsV2 } from "./SettlementTermsV2.sol";
import { PoolExecutionV2 } from "./PoolExecutionV2.sol";

/// @notice Integrates proof-bound reservation with atomic actual pool execution.
/// @dev ABSTRACT and not deployable. A concrete v2 vault still needs real verifier,
/// domain-compatible tree, deposit/withdraw circuits and liability/solvency logic.
/// It must not accept the standalone spend or accounting primitives as a proof.
abstract contract VerifiedSettlementV2 is IntentLifecycleV2 {
    using TokenTransfer for address;

    error InvalidProofContext();
    error InvalidProof();
    error InvalidExecutionBounds();

    function reserve(
        SettlementTermsV2.Terms calldata terms,
        uint256[32] calldata inputs,
        uint16 maximumBinCrossings,
        bytes calldata proof
    ) external nonReentrant returns (bytes32 intentId) {
        _beforeReservation(terms, inputs);
        _validateContext(terms, inputs);
        if (!_isKnownActionRoot(bytes32(inputs[4])) || !_verifyPrivateAction(proof, inputs)) {
            revert InvalidProof();
        }
        Reservation memory r;
        r.statementHash = keccak256(abi.encode(terms, inputs, maximumBinCrossings));
        r.deadline = terms.deadline;
        for (uint256 i; i < 3; ++i) {
            r.nullifiers[i] = bytes32(inputs[14 + i]);
            r.settlementCommitments[i] = bytes32(inputs[17 + i]);
            r.refundCommitments[i] = bytes32(inputs[20 + i]);
        }
        intentId = _reserve(r);
    }

    function _validateContext(SettlementTermsV2.Terms memory t, uint256[32] memory p) private view {
        (uint128 low, uint128 high) = SettlementTermsV2.limbs(SettlementTermsV2.hash(t));
        if (
            p[0] != 2 || p[1] != block.chainid || p[1] != t.chainId
                || p[2] != uint160(address(this)) || t.settlement != address(this)
                || p[3] != _actionTreeVersion() || p[5] != t.action || p[6] != low || p[7] != high
                || p[8] != t.deadline || p[9] != uint160(t.asset0) || p[10] != uint160(t.asset1)
                || p[11] != uint160(t.pool) || p[12] != t.model
                || p[13] != uint256(int256(t.binId) + int256(1 << 23))
                || p[17] != uint256(t.outputCommitment0) || p[18] != uint256(t.outputCommitment1)
                || keccak256(abi.encode(bytes32(p[20]), bytes32(p[21]), bytes32(p[22])))
                    != t.refundCommitment
        ) revert InvalidProofContext();
        for (uint256 i = 23; i < 32; ++i) {
            if (p[i] > type(uint128).max) revert InvalidExecutionBounds();
        }
        if (p[29] > t.maximumFee0 || p[30] > t.maximumFee1 || p[31] != 0) {
            revert InvalidExecutionBounds();
        }
        if (t.action == 4) {
            if (p[28] != t.shares || p[23] < t.minimum0 || p[24] < t.minimum1) {
                revert InvalidExecutionBounds();
            }
        } else {
            if (p[26] != t.amount0 || p[27] != t.amount1) revert InvalidExecutionBounds();
            if (t.action == 3 && p[25] < t.minimumShares) revert InvalidExecutionBounds();
            if (t.action == 2 && (p[23] < t.minimum0 || p[24] < t.minimum1)) {
                revert InvalidExecutionBounds();
            }
        }
    }

    function _executeAtomic(bytes32, bytes calldata statement) internal override {
        (SettlementTermsV2.Terms memory t, uint256[32] memory p, uint16 crossings) =
            abi.decode(statement, (SettlementTermsV2.Terms, uint256[32], uint16));
        // Already proof-verified and hash-bound at reserve; do not require its old
        // root to remain in a rolling root history while the intent is pending.
        _validateContext(t, p);
        _beforeExecution(t, p);
        uint128[3] memory inflows;
        uint128[3] memory outflows;
        for (uint256 i; i < 3; ++i) {
            inflows[i] = uint128(p[23 + i]);
            outflows[i] = uint128(p[26 + i]);
        }
        PoolExecutionV2.execute(_actionPoolRegistry(), t, crossings, inflows, outflows);
        if (p[29] != 0) t.asset0.pushExact(t.feeRecipient, p[29]);
        if (p[30] != 0) t.asset1.pushExact(t.feeRecipient, p[30]);
        _recordActionAccounting(p);
        _assertActionSolvent(p);
    }

    function _actionTreeVersion() internal view virtual returns (uint64);
    function _beforeReservation(SettlementTermsV2.Terms memory, uint256[32] memory)
        internal
        view
        virtual { }
    function _beforeExecution(SettlementTermsV2.Terms memory, uint256[32] memory)
        internal
        view
        virtual { }
    function _isKnownActionRoot(bytes32 root) internal view virtual returns (bool);
    function _verifyPrivateAction(bytes calldata proof, uint256[32] calldata inputs)
        internal
        view
        virtual
        returns (bool);
    function _actionPoolRegistry() internal view virtual returns (PoolRegistry);
    function _recordActionAccounting(uint256[32] memory inputs) internal virtual;
    function _assertActionSolvent(uint256[32] memory inputs) internal view virtual;
}

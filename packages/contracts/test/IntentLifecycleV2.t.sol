// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IntentLifecycleV2 } from "../src/privacy/v2/IntentLifecycleV2.sol";

interface LifecycleClock {
    function warp(uint256 timestamp) external;
}

contract ThirdPartyRefundCaller {
    function trigger(IntentLifecycleV2 lifecycle, bytes32 intentId) external {
        lifecycle.refund(intentId);
    }
}

/// @dev State-machine harness only: intentionally no custody or proof acceptance.
contract LifecycleHarness is IntentLifecycleV2 {
    bool public failExecution;
    bool public failInsertion;
    uint256 public executions;
    uint256 public insertions;
    bytes32 public lastCommitment;

    function prepare(Reservation memory r) external returns (bytes32) {
        return _reserve(r);
    }

    function failures(bool execution, bool insertion) external {
        failExecution = execution;
        failInsertion = insertion;
    }

    function _executeAtomic(bytes32, bytes calldata) internal override {
        ++executions;
        require(!failExecution, "pool failure");
    }

    function _appendNotes(bytes32[3] memory commitments) internal override {
        ++insertions;
        lastCommitment = commitments[0];
        require(!failInsertion, "tree failure");
    }
}

contract IntentLifecycleV2Test {
    LifecycleClock private constant CLOCK =
        LifecycleClock(address(uint160(uint256(keccak256("hevm cheat code")))));

    function fixture() private view returns (IntentLifecycleV2.Reservation memory r) {
        r.statementHash = keccak256(hex"1234");
        r.deadline = uint64(block.timestamp + 100);
        r.nullifiers[0] = bytes32(uint256(1));
        r.settlementCommitments[0] = bytes32(uint256(2));
        r.refundCommitments[0] = bytes32(uint256(3));
    }

    function rejected(address target, bytes memory callData) private {
        (bool ok,) = target.call(callData);
        require(!ok, "call should reject");
    }

    function testAtomicSuccessCannotSettleOrRefundTwice() public {
        LifecycleHarness h = new LifecycleHarness();
        bytes32 id = h.prepare(fixture());
        h.settle(id, hex"1234");
        require(h.intentStatus(id) == IntentLifecycleV2.Status.Settled, "not settled");
        require(h.executions() == 1 && h.insertions() == 1, "missing atomic work");
        rejected(address(h), abi.encodeCall(h.settle, (id, hex"1234")));
        rejected(address(h), abi.encodeCall(h.refund, (id)));
        rejected(address(h), abi.encodeCall(h.prepare, (fixture())));
    }

    function testPoolAndInsertionFailureLeaveIntentPending() public {
        LifecycleHarness h = new LifecycleHarness();
        bytes32 id = h.prepare(fixture());
        for (uint256 i; i < 2; ++i) {
            h.failures(i == 0, i == 1);
            rejected(address(h), abi.encodeCall(h.settle, (id, hex"1234")));
            require(h.intentStatus(id) == IntentLifecycleV2.Status.Pending, "lost pending state");
            require(h.executions() == 0 && h.insertions() == 0, "partial execution retained");
        }
        h.failures(false, false);
        h.settle(id, hex"1234");
    }

    function testExpiryBoundaryAndPermissionlessRefundKeepOldNullifierLocked() public {
        LifecycleHarness h = new LifecycleHarness();
        IntentLifecycleV2.Reservation memory r = fixture();
        bytes32 id = h.prepare(r);
        CLOCK.warp(r.deadline);
        rejected(address(h), abi.encodeCall(h.refund, (id)));
        CLOCK.warp(uint256(r.deadline) + 1);
        rejected(address(h), abi.encodeCall(h.settle, (id, hex"1234")));
        new ThirdPartyRefundCaller().trigger(h, id);
        require(h.lastCommitment() == r.refundCommitments[0], "wrong refund output");
        require(h.executions() == 0, "refund called pool");
        require(h.nullifierIntent(r.nullifiers[0]) == id, "old note revived");
        rejected(address(h), abi.encodeCall(h.refund, (id)));
        r.deadline = uint64(block.timestamp + 100);
        rejected(address(h), abi.encodeCall(h.prepare, (r)));
    }

    function testChangedStatementAndDuplicateNullifiersRejectAtomically() public {
        LifecycleHarness h = new LifecycleHarness();
        IntentLifecycleV2.Reservation memory r = fixture();
        r.nullifiers[1] = r.nullifiers[0];
        rejected(address(h), abi.encodeCall(h.prepare, (r)));
        require(h.nullifierIntent(r.nullifiers[0]) == bytes32(0), "partial lock retained");
        r.nullifiers[1] = bytes32(0);
        bytes32 id = h.prepare(r);
        rejected(address(h), abi.encodeCall(h.settle, (id, hex"1235")));
        require(h.intentStatus(id) == IntentLifecycleV2.Status.Pending, "mismatch changed state");
    }

    function testRefundInsertionFailureCanBeRetried() public {
        LifecycleHarness h = new LifecycleHarness();
        IntentLifecycleV2.Reservation memory r = fixture();
        bytes32 id = h.prepare(r);
        CLOCK.warp(uint256(r.deadline) + 1);
        h.failures(false, true);
        rejected(address(h), abi.encodeCall(h.refund, (id)));
        require(h.intentStatus(id) == IntentLifecycleV2.Status.Pending, "refund not retryable");
        h.failures(false, false);
        h.refund(id);
        require(h.intentStatus(id) == IntentLifecycleV2.Status.Refunded, "not refunded");
    }

    function testSettleAllowedAtExactDeadline() public {
        LifecycleHarness h = new LifecycleHarness();
        IntentLifecycleV2.Reservation memory r = fixture();
        bytes32 id = h.prepare(r);
        CLOCK.warp(r.deadline);
        h.settle(id, hex"1234");
        require(h.intentStatus(id) == IntentLifecycleV2.Status.Settled, "boundary rejected");
    }

    function testInvalidReservationRejectsWithoutLockingNotes() public {
        LifecycleHarness h = new LifecycleHarness();
        IntentLifecycleV2.Reservation memory r = fixture();
        r.settlementCommitments[0] = r.refundCommitments[0];
        rejected(address(h), abi.encodeCall(h.prepare, (r)));
        require(h.nullifierIntent(r.nullifiers[0]) == bytes32(0), "retained failed lock");
        r = fixture();
        r.nullifiers[0] = bytes32(
            uint256(21888242871839275222246405745257275088548364400416034343698204186575808495617)
        );
        rejected(address(h), abi.encodeCall(h.prepare, (r)));
        r = fixture();
        r.deadline = uint64(block.timestamp);
        rejected(address(h), abi.encodeCall(h.prepare, (r)));
        r.deadline = uint64(block.timestamp + h.MAX_INTENT_LIFETIME() + 1);
        rejected(address(h), abi.encodeCall(h.prepare, (r)));
    }
}

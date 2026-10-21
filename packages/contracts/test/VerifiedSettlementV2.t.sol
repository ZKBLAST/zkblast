// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { VerifiedSettlementV2 } from "../src/privacy/v2/VerifiedSettlementV2.sol";
import { IntentLifecycleV2 } from "../src/privacy/v2/IntentLifecycleV2.sol";
import { SettlementTermsV2 } from "../src/privacy/v2/SettlementTermsV2.sol";
import { PoolRegistry } from "../src/core/PoolRegistry.sol";
import { DammPool } from "../src/core/DammPool.sol";
import { PoolKey, PoolKeyLib, PoolModel } from "../src/core/PoolTypes.sol";
import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";

/// @dev Mock verifier/tree/accounting ONLY for orchestration tests. Never deploy.
contract VerifiedSettlementHarness is VerifiedSettlementV2 {
    PoolRegistry private immutable _registry;
    bytes32[3] public lastNotes;
    uint256 public accountingCalls;
    bool public failSolvency;

    constructor(PoolRegistry registry) {
        _registry = registry;
    }

    function setSolvencyFailure(bool value) external {
        failSolvency = value;
    }

    function _actionTreeVersion() internal pure override returns (uint64) {
        return 2;
    }

    function _isKnownActionRoot(bytes32 root) internal pure override returns (bool) {
        return root == bytes32(uint256(123));
    }

    function _verifyPrivateAction(bytes calldata proof, uint256[32] calldata)
        internal
        pure
        override
        returns (bool)
    {
        return keccak256(proof) == keccak256(hex"1234");
    }

    function _actionPoolRegistry() internal view override returns (PoolRegistry) {
        return _registry;
    }

    function _recordActionAccounting(uint256[32] memory) internal override {
        ++accountingCalls;
    }

    function _assertActionSolvent(uint256[32] memory) internal view override {
        require(!failSolvency, "solvency failure");
    }

    function _appendNotes(bytes32[3] memory commitments) internal override {
        lastNotes = commitments;
    }
}

contract VerifiedSettlementV2Test {
    PoolRegistry private registry;
    VerifiedSettlementHarness private settlement;
    DammPool private pool;
    MockERC20 private token0;
    MockERC20 private token1;
    uint128 private constant AMOUNT = 100 ether;

    function setUp() public {
        MockERC20 a = new MockERC20("A", "A");
        MockERC20 b = new MockERC20("B", "B");
        PoolKey memory key = PoolKeyLib.normalize(address(a), address(b), PoolModel.DAMM, 3000, 0);
        token0 = MockERC20(key.token0);
        token1 = MockERC20(key.token1);
        registry = PoolRegistry(
            address(
                new ERC1967Proxy(
                    address(new PoolRegistry()),
                    abi.encodeCall(
                        PoolRegistry.initialize, (address(this), address(this), address(this))
                    )
                )
            )
        );
        pool = new DammPool(key, address(this));
        registry.registerPool(PoolKeyLib.id(key), address(pool), key);
        settlement = new VerifiedSettlementHarness(registry);
        token0.mint(address(settlement), 1000 ether);
        token1.mint(address(settlement), 1000 ether);
    }

    function fixture(uint256 offset, uint128 expectedShares)
        private
        view
        returns (SettlementTermsV2.Terms memory t, uint256[32] memory p)
    {
        t.chainId = uint64(block.chainid);
        t.settlement = address(settlement);
        t.action = 3;
        t.pool = address(pool);
        t.asset0 = address(token0);
        t.asset1 = address(token1);
        t.amount0 = AMOUNT;
        t.amount1 = AMOUNT;
        t.minimumShares = 1;
        t.feeRecipient = address(this);
        t.deadline = uint64(block.timestamp + 100);
        t.refundCommitment =
            keccak256(abi.encode(bytes32(offset + 4), bytes32(offset + 5), bytes32(0)));
        p[0] = 2;
        p[1] = block.chainid;
        p[2] = uint160(address(settlement));
        p[3] = 2;
        p[4] = 123;
        p[5] = 3;
        (uint128 low, uint128 high) = SettlementTermsV2.limbs(SettlementTermsV2.hash(t));
        p[6] = low;
        p[7] = high;
        p[8] = t.deadline;
        p[9] = uint160(t.asset0);
        p[10] = uint160(t.asset1);
        p[11] = uint160(t.pool);
        p[13] = 1 << 23;
        p[14] = offset + 1;
        p[15] = offset + 2;
        p[19] = offset + 3;
        p[20] = offset + 4;
        p[21] = offset + 5;
        p[25] = expectedShares;
        p[26] = AMOUNT;
        p[27] = AMOUNT;
    }

    function testProofGatedReservationExecutesActualPoolAndBoundOutput() public {
        (SettlementTermsV2.Terms memory t, uint256[32] memory p) = fixture(0, AMOUNT - 1000);
        bytes32 id = settlement.reserve(t, p, 1, hex"1234");
        settlement.settle(id, abi.encode(t, p, uint16(1)));
        require(pool.sharesOf(address(settlement)) == AMOUNT - 1000, "actual shares missing");
        require(settlement.lastNotes(2) == bytes32(uint256(3)), "wrong private output");
        require(settlement.accountingCalls() == 1, "missing accounting");
    }

    function testInvalidProofAndRefundBindingRejectBeforeLock() public {
        (SettlementTermsV2.Terms memory t, uint256[32] memory p) = fixture(0, AMOUNT - 1000);
        (bool ok,) = address(settlement)
            .call(abi.encodeCall(settlement.reserve, (t, p, uint16(1), hex"1235")));
        require(!ok, "invalid proof accepted");
        p[20] = 99;
        (ok,) = address(settlement)
            .call(abi.encodeCall(settlement.reserve, (t, p, uint16(1), hex"1234")));
        require(!ok, "changed refund accepted");
        require(settlement.nullifierIntent(bytes32(uint256(1))) == bytes32(0), "note locked");
    }

    function testSolvencyFailureRevertsPoolAccountingAndTerminalState() public {
        (SettlementTermsV2.Terms memory t, uint256[32] memory p) = fixture(0, AMOUNT - 1000);
        bytes32 id = settlement.reserve(t, p, 1, hex"1234");
        settlement.setSolvencyFailure(true);
        (bool ok,) = address(settlement)
            .call(abi.encodeCall(settlement.settle, (id, abi.encode(t, p, uint16(1)))));
        require(!ok, "insolvent settlement accepted");
        require(pool.totalShares() == 0 && settlement.accountingCalls() == 0, "partial accounting");
        require(settlement.intentStatus(id) == IntentLifecycleV2.Status.Pending, "pending lost");
    }

    function testBatchFailureRollsBackEarlierPoolExecution() public {
        bytes32[] memory ids = new bytes32[](2);
        bytes[] memory statements = new bytes[](2);
        for (uint256 i; i < 2; ++i) {
            (SettlementTermsV2.Terms memory t, uint256[32] memory p) =
                fixture(i * 10, i == 0 ? AMOUNT - 1000 : AMOUNT + 1);
            ids[i] = settlement.reserve(t, p, 1, hex"1234");
            statements[i] = abi.encode(t, p, uint16(1));
        }
        (bool ok,) =
            address(settlement).call(abi.encodeCall(settlement.settleBatch, (ids, statements)));
        require(!ok, "wrong second fill accepted");
        require(
            pool.totalShares() == 0 && settlement.accountingCalls() == 0, "partial batch retained"
        );
        for (uint256 i; i < 2; ++i) {
            require(
                settlement.intentStatus(ids[i]) == IntentLifecycleV2.Status.Pending,
                "batch note lost"
            );
        }
    }
}

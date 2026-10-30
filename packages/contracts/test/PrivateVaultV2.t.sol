// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { PrivateVaultV2 } from "../src/privacy/v2/PrivateVaultV2.sol";
import { IntentLifecycleV2 } from "../src/privacy/v2/IntentLifecycleV2.sol";
import { SettlementTermsV2 } from "../src/privacy/v2/SettlementTermsV2.sol";
import { Poseidon2FieldHasherV2 } from "../src/privacy/v2/Poseidon2FieldHasherV2.sol";
import {
    IPrivateActionVerifierV2,
    IPrivateFundVerifierV2
} from "../src/privacy/v2/PrivateProofVerifiersV2.sol";
import { PoolRegistry } from "../src/core/PoolRegistry.sol";
import { DammPool } from "../src/core/DammPool.sol";
import { DlmmPool } from "../src/core/DlmmPool.sol";
import { PoolKey, PoolKeyLib, PoolModel } from "../src/core/PoolTypes.sol";
import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";

/// @dev Explicit boundary/accounting mock; NOT a cryptographic verifier.
contract VaultBoundaryVerifierV2 is IPrivateActionVerifierV2, IPrivateFundVerifierV2 {
    function verify(bytes calldata proof, uint256[32] calldata) external pure returns (bool) {
        return keccak256(proof) == keccak256(hex"1234");
    }

    function verify(bytes calldata proof, uint256[11] calldata) external pure returns (bool) {
        return keccak256(proof) == keccak256(hex"1234");
    }
}

interface VaultV2Clock {
    function warp(uint256 timestamp) external;
}

contract PrivateVaultV2Test {
    VaultV2Clock private constant CLOCK =
        VaultV2Clock(address(uint160(uint256(keccak256("hevm cheat code")))));
    PrivateVaultV2 private vault;
    PoolRegistry private registry;
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
        VaultBoundaryVerifierV2 verifier = new VaultBoundaryVerifierV2();
        vault = PrivateVaultV2(
            address(
                new ERC1967Proxy(
                    address(new PrivateVaultV2()),
                    abi.encodeCall(
                        PrivateVaultV2.initialize,
                        (
                            address(this),
                            address(this),
                            registry,
                            new Poseidon2FieldHasherV2(),
                            verifier,
                            verifier,
                            uint64(2)
                        )
                    )
                )
            )
        );
        vault.setAssetEnabled(address(token0), true);
        vault.setAssetEnabled(address(token1), true);
        vault.setPaused(false, false, false);
        token0.mint(address(this), 1000 ether);
        token1.mint(address(this), 1000 ether);
    }

    function fund(address asset, uint256 amount, uint256 commitment)
        private
        view
        returns (uint256[11] memory p)
    {
        p[0] = 2;
        p[2] = block.chainid;
        p[3] = uint160(address(vault));
        p[4] = 2;
        p[7] = uint160(asset);
        p[8] = amount;
        p[10] = commitment;
    }

    function depositPair() private {
        token0.approve(address(vault), AMOUNT);
        vault.deposit(hex"1234", fund(address(token0), AMOUNT, 11));
        token1.approve(address(vault), AMOUNT);
        vault.deposit(hex"1234", fund(address(token1), AMOUNT, 12));
    }

    function addStatement()
        private
        view
        returns (SettlementTermsV2.Terms memory t, uint256[32] memory p)
    {
        t.chainId = uint64(block.chainid);
        t.settlement = address(vault);
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
            keccak256(abi.encode(bytes32(uint256(21)), bytes32(uint256(22)), bytes32(0)));
        p[0] = 2;
        p[1] = block.chainid;
        p[2] = uint160(address(vault));
        p[3] = 2;
        p[4] = uint256(vault.currentRoot());
        p[5] = 3;
        (uint128 low, uint128 high) = SettlementTermsV2.limbs(SettlementTermsV2.hash(t));
        p[6] = low;
        p[7] = high;
        p[8] = t.deadline;
        p[9] = uint160(t.asset0);
        p[10] = uint160(t.asset1);
        p[11] = uint160(t.pool);
        p[13] = 1 << 23;
        p[14] = 101;
        p[15] = 102;
        p[19] = 13;
        p[20] = 21;
        p[21] = 22;
        p[25] = AMOUNT - 1000;
        p[26] = AMOUNT;
        p[27] = AMOUNT;
    }

    function rejected(address target, bytes memory callData) private {
        (bool ok,) = target.call(callData);
        require(!ok, "expected rejection");
    }

    function testDepositWithdrawAccountingAndReplayProtection() public {
        token0.approve(address(vault), AMOUNT);
        bytes32 initialRoot = vault.currentRoot();
        vault.deposit(hex"1234", fund(address(token0), AMOUNT, 11));
        require(
            vault.currentRoot() != initialRoot && vault.isKnownRoot(initialRoot),
            "root history missing"
        );
        require(vault.liabilityRaw(address(token0)) == AMOUNT, "deposit liability");
        uint256[11] memory p = fund(address(token0), AMOUNT, 0);
        p[1] = 1;
        p[5] = uint256(vault.currentRoot());
        p[6] = 101;
        p[9] = uint160(address(this));
        vault.withdraw(hex"1234", p);
        require(vault.liabilityRaw(address(token0)) == 0, "withdraw liability");
        require(token0.balanceOf(address(vault)) == 0, "funds not returned");
        rejected(address(vault), abi.encodeCall(vault.withdraw, (hex"1234", p)));
    }

    function testDepositProofAndV1ContextRejectWithoutTakingFunds() public {
        token0.approve(address(vault), AMOUNT);
        uint256[11] memory p = fund(address(token0), AMOUNT, 11);
        rejected(address(vault), abi.encodeCall(vault.deposit, (hex"1235", p)));
        p[0] = 1;
        rejected(address(vault), abi.encodeCall(vault.deposit, (hex"1234", p)));
        require(
            vault.nextLeafIndex() == 0 && vault.liabilityRaw(address(token0)) == 0, "state changed"
        );
    }

    function testActualLpSettlementConvertsTokenLiabilitiesIntoShares() public {
        depositPair();
        (SettlementTermsV2.Terms memory t, uint256[32] memory p) = addStatement();
        bytes32 id = vault.reserve(t, p, 1, hex"1234");
        vault.settle(id, abi.encode(t, p, uint16(1)));
        require(
            vault.liabilityRaw(address(token0)) == 0 && vault.liabilityRaw(address(token1)) == 0,
            "token liabilities remain"
        );
        require(
            vault.shareLiability(vault.shareResource(address(pool), 0, 0)) == AMOUNT - 1000,
            "share liability"
        );
        require(vault.commitmentInserted(bytes32(uint256(13))), "LP note absent");
        require(!vault.commitmentInserted(bytes32(uint256(21))), "refund inserted after settle");
    }

    function testReservedNotesCannotWithdrawAndRefundPreservesLiabilities() public {
        depositPair();
        (SettlementTermsV2.Terms memory t, uint256[32] memory p) = addStatement();
        bytes32 id = vault.reserve(t, p, 1, hex"1234");
        uint256[11] memory withdrawal = fund(address(token0), AMOUNT, 0);
        withdrawal[1] = 1;
        withdrawal[5] = p[4];
        withdrawal[6] = 101;
        withdrawal[9] = uint160(address(this));
        rejected(address(vault), abi.encodeCall(vault.withdraw, (hex"1234", withdrawal)));
        vault.setPaused(true, true, false);
        CLOCK.warp(uint256(t.deadline) + 1);
        vault.refund(id);
        require(vault.liabilityRaw(address(token0)) == AMOUNT, "refund altered liability");
        require(
            vault.commitmentInserted(bytes32(uint256(21)))
                && vault.commitmentInserted(bytes32(uint256(22))),
            "refund notes absent"
        );
        require(vault.intentStatus(id) == IntentLifecycleV2.Status.Refunded, "not refunded");
        rejected(address(vault), abi.encodeCall(vault.withdraw, (hex"1234", withdrawal)));
    }

    function testWithdrawalSpendBlocksLaterActionReservation() public {
        depositPair();
        (SettlementTermsV2.Terms memory t, uint256[32] memory p) = addStatement();
        uint256[11] memory withdrawal = fund(address(token0), AMOUNT, 0);
        withdrawal[1] = 1;
        withdrawal[5] = p[4];
        withdrawal[6] = 101;
        withdrawal[9] = uint160(address(this));
        vault.withdraw(hex"1234", withdrawal);
        rejected(address(vault), abi.encodeCall(vault.reserve, (t, p, uint16(1), hex"1234")));
    }

    function testDuplicateCommitmentAndDisabledAssetCannotTakeFunds() public {
        token0.approve(address(vault), 2 * AMOUNT);
        uint256[11] memory p = fund(address(token0), AMOUNT, 11);
        vault.deposit(hex"1234", p);
        rejected(address(vault), abi.encodeCall(vault.deposit, (hex"1234", p)));
        vault.setAssetEnabled(address(token0), false);
        p[10] = 12;
        rejected(address(vault), abi.encodeCall(vault.deposit, (hex"1234", p)));
        require(vault.liabilityRaw(address(token0)) == AMOUNT, "unexpected liability");
    }

    function testDlmmShareLiabilityIsBoundToItsActualBin() public {
        depositPair();
        PoolKey memory key = PoolKey(address(token0), address(token1), PoolModel.DLMM, 3000, 10);
        DlmmPool discrete = new DlmmPool(key, address(this), -1);
        registry.registerPool(PoolKeyLib.id(key), address(discrete), key);
        (SettlementTermsV2.Terms memory t, uint256[32] memory p) = addStatement();
        t.pool = address(discrete);
        t.model = 1;
        t.binId = -1;
        (uint128 low, uint128 high) = SettlementTermsV2.limbs(SettlementTermsV2.hash(t));
        p[6] = low;
        p[7] = high;
        p[11] = uint160(t.pool);
        p[12] = 1;
        p[13] = (1 << 23) - 1;
        bytes32 id = vault.reserve(t, p, 1, hex"1234");
        vault.settle(id, abi.encode(t, p, uint16(1)));
        require(
            vault.shareLiability(vault.shareResource(t.pool, 1, -1)) == AMOUNT - 1000,
            "wrong bin liability"
        );
        require(vault.shareLiability(vault.shareResource(t.pool, 1, 0)) == 0, "bin balances mixed");
        require(discrete.sharesOf(-1, address(vault)) == AMOUNT - 1000, "actual bin shares");
    }

    function testRootHistoryEvictsOnlyAfterConfiguredWindow() public {
        token0.approve(address(vault), 257);
        bytes32 initial = vault.currentRoot();
        bytes32 first;
        for (uint256 i; i < 256; ++i) {
            vault.deposit(hex"1234", fund(address(token0), 1, i + 500));
            if (i == 0) first = vault.currentRoot();
        }
        require(!vault.isKnownRoot(initial) && vault.isKnownRoot(first), "incorrect history window");
        vault.deposit(hex"1234", fund(address(token0), 1, 1000));
        require(
            !vault.isKnownRoot(first) && vault.isKnownRoot(vault.currentRoot()),
            "history eviction failed"
        );
        require(vault.liabilityRaw(address(token0)) == 257, "history changed accounting");
    }

    function testProxyUpgradePreservesExistingV2NotesAndLiabilities() public {
        depositPair();
        bytes32 root = vault.currentRoot();
        vault.upgradeToAndCall(address(new PrivateVaultV2()), bytes(""));
        require(
            vault.currentRoot() == root && vault.liabilityRaw(address(token0)) == AMOUNT,
            "upgrade lost notes"
        );
        uint256[11] memory p = fund(address(token0), AMOUNT, 0);
        p[1] = 1;
        p[5] = uint256(root);
        p[6] = 101;
        p[9] = uint160(address(this));
        vault.withdraw(hex"1234", p);
        require(vault.liabilityRaw(address(token0)) == 0, "upgraded note cannot withdraw");
    }

    function testAuthorizedPerpsBridgePreservesLiabilityAndReplayProtection() public {
        token0.approve(address(vault), 2 * AMOUNT);
        vault.deposit(hex"1234", fund(address(token0), AMOUNT, 2001));
        bytes32 root = vault.currentRoot();
        vault.setPerpsAdapterAuthorization(address(this), true);
        vault.consumePerpsNote(
            address(token0), 2, root, bytes32(uint256(700)), AMOUNT, address(this)
        );
        require(vault.liabilityRaw(address(token0)) == 0, "consume liability");
        rejected(
            address(vault),
            abi.encodeCall(
                vault.consumePerpsNote,
                (address(token0), 2, root, bytes32(uint256(700)), AMOUNT, address(this))
            )
        );
        token0.approve(address(vault), AMOUNT);
        vault.insertPerpsNote(address(token0), AMOUNT, bytes32(uint256(2002)), address(this));
        require(vault.liabilityRaw(address(token0)) == AMOUNT, "insert liability");
        require(vault.commitmentInserted(bytes32(uint256(2002))), "perps note missing");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { LaunchpadFeeController } from "../src/launchpad/LaunchpadFeeController.sol";
import { LaunchpadRegistry } from "../src/launchpad/LaunchpadRegistry.sol";
import { RevenueSplitter } from "../src/launchpad/RevenueSplitter.sol";
import {
    LaunchpadProofClaimAdapter,
    ILaunchpadClaimVerifier
} from "../src/launchpad/LaunchpadProofClaimAdapter.sol";
import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";

contract FailingClaimToken {
    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;
    bool public failTransfers;

    function setFailTransfers(bool value) external {
        failTransfers = value;
    }

    function mint(address recipient, uint256 amount) external {
        balanceOf[recipient] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount)
        external
        returns (bool)
    {
        uint256 available = allowance[sender][msg.sender];
        if (available != type(uint256).max) allowance[sender][msg.sender] = available - amount;
        balanceOf[sender] -= amount;
        balanceOf[recipient] += amount;
        return true;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        if (failTransfers) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        return true;
    }
}

contract FeeRecipient {
    function claim(RevenueSplitter splitter, bytes32 snapshotId) external returns (uint256) {
        return splitter.claim(snapshotId);
    }

    function setProofAuthorization(
        LaunchpadProofClaimAdapter adapter,
        bytes32 snapshotId,
        bytes32 commitment
    ) external {
        adapter.setAuthorizationCommitment(snapshotId, commitment);
    }
}

contract LaunchpadClaimVerifierMock is ILaunchpadClaimVerifier {
    function verify(bytes calldata proof, uint256[15] calldata)
        external
        pure
        returns (bool)
    {
        return keccak256(proof) == keccak256("valid-launchpad-claim-proof");
    }
}

contract ForeignLaunchpadOwner {
    function setPolicy(
        LaunchpadFeeController controller,
        uint256 launchpadId,
        LaunchpadFeeController.FeeShares calldata shares,
        address operatorRecipient
    ) external returns (bool success) {
        (success,) = address(controller).call(
            abi.encodeCall(
                LaunchpadFeeController.setLaunchpadFeePolicy,
                (launchpadId, 100, shares, operatorRecipient)
            )
        );
    }
}

contract LaunchpadFeesTest {
    LaunchpadRegistry private registry;
    LaunchpadFeeController private controller;
    RevenueSplitter private splitter;
    MockERC20 private asset;
    FeeRecipient private protocolRecipient;
    FeeRecipient private operatorRecipient;
    FeeRecipient private creatorRecipient;
    FeeRecipient private referralRecipient;
    uint256 private launchpadId;

    function setUp() public {
        registry = LaunchpadRegistry(
            address(
                new ERC1967Proxy(
                    address(new LaunchpadRegistry()),
                    abi.encodeCall(
                        LaunchpadRegistry.initialize,
                        (address(this), address(this), address(this))
                    )
                )
            )
        );
        launchpadId = registry.registerLaunchpad(
            address(this),
            address(this),
            keccak256("fee launchpad metadata"),
            keccak256("fee-launchpad"),
            1
        );

        protocolRecipient = new FeeRecipient();
        operatorRecipient = new FeeRecipient();
        creatorRecipient = new FeeRecipient();
        referralRecipient = new FeeRecipient();
        controller = LaunchpadFeeController(
            address(
                new ERC1967Proxy(
                    address(new LaunchpadFeeController()),
                    abi.encodeCall(
                        LaunchpadFeeController.initialize,
                        (
                            address(this),
                            address(this),
                            registry,
                            address(protocolRecipient)
                        )
                    )
                )
            )
        );
        controller.setRole(controller.FACTORY_ROLE(), address(this), true);

        splitter = RevenueSplitter(
            address(
                new ERC1967Proxy(
                    address(new RevenueSplitter()),
                    abi.encodeCall(
                        RevenueSplitter.initialize, (address(this), address(this))
                    )
                )
            )
        );
        splitter.setRole(splitter.FACTORY_ROLE(), address(this), true);
        splitter.setRole(splitter.ACCRUAL_ROLE(), address(this), true);
        asset = new MockERC20("Launch Quote", "LQ");
        asset.approve(address(splitter), type(uint256).max);
    }

    function testAccrualConservesUnevenAmountAndClaimsStayIsolated() external {
        bytes32 snapshotId = _registerSnapshot(address(0xA11CE), _standardShares());
        asset.mint(address(this), 101);
        splitter.accrue(snapshotId, RevenueSplitter.RevenueKind.TRADE_FEE, 101);

        uint256 protocolAmount = splitter.claimable(address(protocolRecipient), address(asset));
        uint256 operatorAmount = splitter.claimable(address(operatorRecipient), address(asset));
        uint256 creatorAmount = splitter.claimable(address(creatorRecipient), address(asset));
        uint256 referralAmount = splitter.claimable(address(referralRecipient), address(asset));
        require(protocolAmount == 21, "dust not assigned to protocol");
        require(operatorAmount == 30, "operator allocation");
        require(creatorAmount == 40, "creator allocation");
        require(referralAmount == 10, "referral allocation");
        require(
            protocolAmount + operatorAmount + creatorAmount + referralAmount == 101,
            "fee not conserved"
        );
        require(splitter.totalLiability(address(asset)) == 101, "liability");
        require(splitter.isSolvent(address(asset)), "insolvent");

        (bool foreignClaim,) = address(splitter).call(
            abi.encodeCall(RevenueSplitter.claim, (snapshotId))
        );
        require(!foreignClaim, "cross-recipient claim succeeded");
        require(operatorRecipient.claim(splitter, snapshotId) == 30, "claim amount");
        require(asset.balanceOf(address(operatorRecipient)) == 30, "claim transfer");
        require(splitter.totalLiability(address(asset)) == 71, "claim liability");
    }

    function testProofClaimBindsContextKeepsPublicClaimAndRejectsReplay() external {
        address pool = address(0xA11CE);
        bytes32 snapshotId = _registerSnapshot(pool, _standardShares());
        asset.mint(address(this), 100);
        splitter.accrue(snapshotId, RevenueSplitter.RevenueKind.TRADE_FEE, 100);
        LaunchpadProofClaimAdapter adapter = new LaunchpadProofClaimAdapter(
            splitter, new LaunchpadClaimVerifierMock()
        );
        splitter.setRole(splitter.PROOF_CLAIM_ROLE(), address(adapter), true);
        bytes32 commitment = bytes32(uint256(123456));
        operatorRecipient.setProofAuthorization(adapter, snapshotId, commitment);
        uint256[15] memory inputs = _proofInputs(
            adapter,
            snapshotId,
            pool,
            address(operatorRecipient),
            commitment,
            bytes32(uint256(654321))
        );

        uint256 original;
        uint256[8] memory indexes = [uint256(1), 2, 4, 5, 6, 11, 12, 14];
        uint256[8] memory invalidValues = [
            uint256(2),
            block.chainid + 1,
            uint256(2),
            launchpadId + 1,
            uint256(uint160(address(0xBADC0DE))),
            uint256(29),
            block.timestamp - 1,
            uint256(999)
        ];
        for (uint256 index; index < indexes.length; ++index) {
            original = inputs[indexes[index]];
            inputs[indexes[index]] = invalidValues[index];
            _expectProofClaimRejected(adapter, inputs);
            inputs[indexes[index]] = original;
        }
        _expectProofClaimRejected(adapter, inputs, "invalid-proof");

        uint256 amount = adapter.claimWithProof("valid-launchpad-claim-proof", inputs);
        require(amount == 30, "proof claim amount");
        require(asset.balanceOf(address(operatorRecipient)) == 30, "proof payout");
        require(adapter.nullifierSpent(bytes32(inputs[13])), "nullifier not spent");
        (bool replay,) = address(adapter).call(
            abi.encodeCall(
                LaunchpadProofClaimAdapter.claimWithProof,
                (bytes("valid-launchpad-claim-proof"), inputs)
            )
        );
        require(!replay, "proof replay accepted");

        // The normal claim path remains available for another recipient.
        require(creatorRecipient.claim(splitter, snapshotId) == 40, "public claim removed");
    }

    function _expectProofClaimRejected(
        LaunchpadProofClaimAdapter adapter,
        uint256[15] memory inputs
    ) private {
        _expectProofClaimRejected(adapter, inputs, "valid-launchpad-claim-proof");
    }

    function _expectProofClaimRejected(
        LaunchpadProofClaimAdapter adapter,
        uint256[15] memory inputs,
        bytes memory proof
    ) private {
        (bool success,) = address(adapter).call(
            abi.encodeCall(LaunchpadProofClaimAdapter.claimWithProof, (proof, inputs))
        );
        require(!success, "invalid proof context accepted");
    }

    function _proofInputs(
        LaunchpadProofClaimAdapter adapter,
        bytes32 snapshotId,
        address pool,
        address recipient,
        bytes32 commitment,
        bytes32 nullifier
    ) private view returns (uint256[15] memory inputs) {
        uint256 snapshot = uint256(snapshotId);
        inputs[0] = 1;
        inputs[1] = 1;
        inputs[2] = block.chainid;
        inputs[3] = uint160(address(adapter));
        inputs[4] = 1;
        inputs[5] = launchpadId;
        inputs[6] = uint160(pool);
        inputs[7] = uint128(snapshot);
        inputs[8] = uint128(snapshot >> 128);
        inputs[9] = uint160(recipient);
        inputs[10] = uint160(address(asset));
        inputs[11] = 30;
        inputs[12] = block.timestamp + 1 hours;
        inputs[13] = uint256(nullifier);
        inputs[14] = uint256(commitment);
    }

    function testFeeCapOwnershipAndExactShareSumAreEnforced() external {
        LaunchpadFeeController.FeeShares memory shares = _standardShares();
        (bool excessiveFee,) = address(controller).call(
            abi.encodeCall(
                LaunchpadFeeController.setLaunchpadFeePolicy,
                (launchpadId, 301, shares, address(operatorRecipient))
            )
        );
        require(!excessiveFee, "fee cap bypassed");

        shares.referralShareBps = 799;
        (bool invalidSum,) = address(controller).call(
            abi.encodeCall(
                LaunchpadFeeController.setLaunchpadFeePolicy,
                (launchpadId, 100, shares, address(operatorRecipient))
            )
        );
        require(!invalidSum, "invalid share sum accepted");

        ForeignLaunchpadOwner foreignOwner = new ForeignLaunchpadOwner();
        require(
            !foreignOwner.setPolicy(
                controller, launchpadId, _standardShares(), address(operatorRecipient)
            ),
            "foreign owner changed policy"
        );
    }

    function testSnapshotIsImmutableAndRecipientRotationOnlyAffectsFuturePools() external {
        bytes32 first = _registerSnapshot(address(0xA11CE), _standardShares());
        FeeRecipient nextOperator = new FeeRecipient();
        controller.setLaunchpadFeePolicy(
            launchpadId, 100, _standardShares(), address(nextOperator)
        );
        bytes32 second = controller.snapshotPolicy(
            launchpadId, address(0xB0B), address(creatorRecipient), address(referralRecipient)
        );

        require(
            controller.snapshot(first).operatorRecipient == address(operatorRecipient),
            "old snapshot changed"
        );
        require(
            controller.snapshot(second).operatorRecipient == address(nextOperator),
            "new snapshot did not rotate"
        );
        (bool duplicatePool,) = address(controller).call(
            abi.encodeCall(
                LaunchpadFeeController.snapshotPolicy,
                (
                    launchpadId,
                    address(0xA11CE),
                    address(creatorRecipient),
                    address(referralRecipient)
                )
            )
        );
        require(!duplicatePool, "pool snapshot overwritten");
    }

    function testZeroReferralRoutesNoValueToZeroAddress() external {
        LaunchpadFeeController.FeeShares memory shares = LaunchpadFeeController.FeeShares({
            protocolShareBps: 2_000,
            operatorShareBps: 3_000,
            creatorShareBps: 5_000,
            referralShareBps: 0
        });
        bytes32 snapshotId = _registerSnapshot(address(0xCAFE), shares);
        asset.mint(address(this), 1);
        splitter.accrue(snapshotId, RevenueSplitter.RevenueKind.POOL_FEE, 1);
        require(splitter.claimable(address(0), address(asset)) == 0, "zero recipient liability");
        require(
            splitter.claimable(address(protocolRecipient), address(asset)) == 1,
            "dust conservation"
        );
    }

    function testFuzzAccrualAlwaysConserves(uint96 rawAmount) external {
        uint256 amount = uint256(rawAmount) + 1;
        bytes32 snapshotId = _registerSnapshot(address(0xF00D), _standardShares());
        asset.mint(address(this), amount);
        splitter.accrue(snapshotId, RevenueSplitter.RevenueKind.LP_REWARD, amount);
        uint256 allocated = splitter.claimable(address(protocolRecipient), address(asset))
            + splitter.claimable(address(operatorRecipient), address(asset))
            + splitter.claimable(address(creatorRecipient), address(asset))
            + splitter.claimable(address(referralRecipient), address(asset));
        require(allocated == amount, "fuzz conservation");
        require(splitter.totalLiability(address(asset)) == amount, "fuzz liability");
        require(splitter.isSolvent(address(asset)), "fuzz solvency");
    }

    function testRevenueKindsAndReconciliationRemainSeparated() external {
        bytes32 snapshotId = _registerSnapshot(address(0xD00D), _standardShares());
        asset.mint(address(this), 14);
        splitter.accrue(snapshotId, RevenueSplitter.RevenueKind.TRADE_FEE, 2);
        splitter.accrue(snapshotId, RevenueSplitter.RevenueKind.POOL_FEE, 3);
        splitter.accrue(snapshotId, RevenueSplitter.RevenueKind.GRADUATION_FEE, 4);
        splitter.accrue(snapshotId, RevenueSplitter.RevenueKind.LP_REWARD, 5);

        require(
            splitter.accruedByKind(snapshotId, RevenueSplitter.RevenueKind.TRADE_FEE) == 2,
            "trade accounting"
        );
        require(
            splitter.accruedByKind(snapshotId, RevenueSplitter.RevenueKind.POOL_FEE) == 3,
            "pool accounting"
        );
        require(
            splitter.accruedByKind(
                snapshotId, RevenueSplitter.RevenueKind.GRADUATION_FEE
            ) == 4,
            "graduation accounting"
        );
        require(
            splitter.accruedByKind(snapshotId, RevenueSplitter.RevenueKind.LP_REWARD) == 5,
            "lp accounting"
        );
        (uint256 balance, uint256 liability, uint256 surplus) =
            splitter.reconciliation(address(asset));
        require(balance == 14 && liability == 14 && surplus == 0, "reconciliation");
    }

    function testClaimFailurePreservesLiabilityAndCanBeRetried() external {
        controller.setLaunchpadFeePolicy(
            launchpadId, 100, _standardShares(), address(operatorRecipient)
        );
        bytes32 snapshotId = controller.snapshotPolicy(
            launchpadId,
            address(0xFA11),
            address(creatorRecipient),
            address(referralRecipient)
        );
        FailingClaimToken failingAsset = new FailingClaimToken();
        splitter.registerSnapshot(
            snapshotId, controller.snapshot(snapshotId), address(failingAsset)
        );
        failingAsset.mint(address(this), 100);
        failingAsset.approve(address(splitter), 100);
        splitter.accrue(snapshotId, RevenueSplitter.RevenueKind.TRADE_FEE, 100);
        failingAsset.setFailTransfers(true);

        (bool failedClaim,) = address(operatorRecipient).call(
            abi.encodeCall(FeeRecipient.claim, (splitter, snapshotId))
        );
        require(!failedClaim, "failing transfer was accepted");
        require(
            splitter.claimableBySnapshot(snapshotId, address(operatorRecipient)) == 30,
            "failed claim lost liability"
        );
        require(splitter.totalLiability(address(failingAsset)) == 100, "liability changed");

        failingAsset.setFailTransfers(false);
        require(operatorRecipient.claim(splitter, snapshotId) == 30, "retry failed");
        require(failingAsset.balanceOf(address(operatorRecipient)) == 30, "retry transfer");
    }

    function testClaimIsScopedToSelectedPoolSnapshot() external {
        bytes32 first = _registerSnapshot(address(0x1111), _standardShares());
        bytes32 second = _registerSnapshot(address(0x2222), _standardShares());
        asset.mint(address(this), 20);
        splitter.accrue(first, RevenueSplitter.RevenueKind.TRADE_FEE, 10);
        splitter.accrue(second, RevenueSplitter.RevenueKind.TRADE_FEE, 10);
        uint256 secondBefore =
            splitter.claimableBySnapshot(second, address(operatorRecipient));

        operatorRecipient.claim(splitter, first);
        require(
            splitter.claimableBySnapshot(first, address(operatorRecipient)) == 0,
            "selected snapshot not cleared"
        );
        require(
            splitter.claimableBySnapshot(second, address(operatorRecipient)) == secondBefore,
            "other snapshot claim changed"
        );
    }

    function _registerSnapshot(
        address pool,
        LaunchpadFeeController.FeeShares memory shares
    ) private returns (bytes32 snapshotId) {
        controller.setLaunchpadFeePolicy(
            launchpadId, 100, shares, address(operatorRecipient)
        );
        snapshotId = controller.snapshotPolicy(
            launchpadId, pool, address(creatorRecipient), address(referralRecipient)
        );
        splitter.registerSnapshot(snapshotId, controller.snapshot(snapshotId), address(asset));
    }

    function _standardShares()
        private
        pure
        returns (LaunchpadFeeController.FeeShares memory)
    {
        return LaunchpadFeeController.FeeShares({
            protocolShareBps: 2_000,
            operatorShareBps: 3_000,
            creatorShareBps: 4_000,
            referralShareBps: 1_000
        });
    }
}

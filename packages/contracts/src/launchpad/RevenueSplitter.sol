// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { IERC20Minimal } from "../interfaces/IERC20Minimal.sol";
import { TokenTransfer } from "../libraries/TokenTransfer.sol";
import { ReentrancyGuard } from "../security/ReentrancyGuard.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { LaunchpadFeeController } from "./LaunchpadFeeController.sol";

contract RevenueSplitter is ProtocolAccess, UUPSUpgradeable, ReentrancyGuard {
    using TokenTransfer for address;

    error InvalidSnapshot();
    error SnapshotAlreadyRegistered();
    error NothingToClaim();

    bytes32 public constant ACCRUAL_ROLE = keccak256("ZKBLAST_LAUNCHPAD_FEE_ACCRUAL_ROLE");
    bytes32 public constant PROOF_CLAIM_ROLE = keccak256("ZKBLAST_LAUNCHPAD_PROOF_CLAIM_ROLE");
    uint256 private constant BPS = 10_000;

    enum RevenueKind {
        TRADE_FEE,
        POOL_FEE,
        GRADUATION_FEE,
        LP_REWARD
    }

    struct RegisteredSnapshot {
        uint256 launchpadId;
        address pool;
        address asset;
        address protocolRecipient;
        address operatorRecipient;
        address creatorRecipient;
        address referralRecipient;
        LaunchpadFeeController.FeeShares shares;
        bool registered;
    }

    mapping(bytes32 snapshotId => RegisteredSnapshot snapshot) private _snapshots;
    mapping(address recipient => mapping(address asset => uint256 amount)) public claimable;
    mapping(address asset => uint256 amount) public totalLiability;
    mapping(bytes32 snapshotId => mapping(address recipient => uint256 amount))
        public claimableBySnapshot;
    mapping(bytes32 snapshotId => mapping(RevenueKind kind => uint256 amount))
        public accruedByKind;

    event RevenueSnapshotRegistered(
        bytes32 indexed snapshotId,
        uint256 indexed launchpadId,
        address indexed pool,
        address asset
    );
    event FeeAccrued(
        bytes32 indexed snapshotId,
        uint256 indexed launchpadId,
        address indexed asset,
        address pool,
        RevenueKind kind,
        uint256 amount,
        uint256 protocolAmount,
        uint256 operatorAmount,
        uint256 creatorAmount,
        uint256 referralAmount
    );
    event FeeClaimed(
        bytes32 indexed snapshotId,
        uint256 indexed launchpadId,
        address indexed recipient,
        address pool,
        address asset,
        uint256 amount
    );

    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address upgrader) external initializer {
        __ProtocolAccess_init(admin, upgrader);
    }

    function registerSnapshot(
        bytes32 snapshotId,
        LaunchpadFeeController.FeeSnapshot calldata policy,
        address asset
    ) external onlyRole(FACTORY_ROLE) {
        if (
            snapshotId == bytes32(0) || policy.pool == address(0) || asset == address(0)
                || asset.code.length == 0 || policy.protocolRecipient == address(0)
                || policy.operatorRecipient == address(0) || policy.creatorRecipient == address(0)
        ) revert InvalidSnapshot();
        if (_snapshots[snapshotId].registered) revert SnapshotAlreadyRegistered();
        if (
            policy.shares.referralShareBps != 0 && policy.referralRecipient == address(0)
        ) revert InvalidSnapshot();
        _snapshots[snapshotId] = RegisteredSnapshot({
            launchpadId: policy.launchpadId,
            pool: policy.pool,
            asset: asset,
            protocolRecipient: policy.protocolRecipient,
            operatorRecipient: policy.operatorRecipient,
            creatorRecipient: policy.creatorRecipient,
            referralRecipient: policy.referralRecipient,
            shares: policy.shares,
            registered: true
        });
        emit RevenueSnapshotRegistered(snapshotId, policy.launchpadId, policy.pool, asset);
    }

    function accrue(bytes32 snapshotId, RevenueKind kind, uint256 amount)
        external
        onlyRole(ACCRUAL_ROLE)
        nonReentrant
    {
        RegisteredSnapshot storage item = _snapshots[snapshotId];
        if (!item.registered || amount == 0) revert InvalidSnapshot();
        item.asset.pullExact(msg.sender, amount);

        uint256 operatorAmount = amount * item.shares.operatorShareBps / BPS;
        uint256 creatorAmount = amount * item.shares.creatorShareBps / BPS;
        uint256 referralAmount = amount * item.shares.referralShareBps / BPS;
        uint256 protocolAmount = amount - operatorAmount - creatorAmount - referralAmount;
        claimable[item.protocolRecipient][item.asset] += protocolAmount;
        claimable[item.operatorRecipient][item.asset] += operatorAmount;
        claimable[item.creatorRecipient][item.asset] += creatorAmount;
        claimableBySnapshot[snapshotId][item.protocolRecipient] += protocolAmount;
        claimableBySnapshot[snapshotId][item.operatorRecipient] += operatorAmount;
        claimableBySnapshot[snapshotId][item.creatorRecipient] += creatorAmount;
        if (referralAmount != 0) {
            claimable[item.referralRecipient][item.asset] += referralAmount;
            claimableBySnapshot[snapshotId][item.referralRecipient] += referralAmount;
        }
        accruedByKind[snapshotId][kind] += amount;
        totalLiability[item.asset] += amount;
        emit FeeAccrued(
            snapshotId,
            item.launchpadId,
            item.asset,
            item.pool,
            kind,
            amount,
            protocolAmount,
            operatorAmount,
            creatorAmount,
            referralAmount
        );
    }

    function claim(bytes32 snapshotId) external nonReentrant returns (uint256 amount) {
        return _claim(snapshotId, msg.sender);
    }

    function claimFor(bytes32 snapshotId, address recipient)
        external
        onlyRole(PROOF_CLAIM_ROLE)
        nonReentrant
        returns (uint256 amount)
    {
        if (recipient == address(0)) revert InvalidSnapshot();
        return _claim(snapshotId, recipient);
    }

    function _claim(bytes32 snapshotId, address recipient) private returns (uint256 amount) {
        RegisteredSnapshot storage item = _snapshots[snapshotId];
        if (!item.registered) revert InvalidSnapshot();
        amount = claimableBySnapshot[snapshotId][recipient];
        if (amount == 0) revert NothingToClaim();
        claimableBySnapshot[snapshotId][recipient] = 0;
        claimable[recipient][item.asset] -= amount;
        totalLiability[item.asset] -= amount;
        item.asset.pushExact(recipient, amount);
        emit FeeClaimed(
            snapshotId,
            item.launchpadId,
            recipient,
            item.pool,
            item.asset,
            amount
        );
    }

    function snapshot(bytes32 snapshotId)
        external
        view
        returns (RegisteredSnapshot memory item)
    {
        item = _snapshots[snapshotId];
        if (!item.registered) revert InvalidSnapshot();
    }

    function isSolvent(address asset) external view returns (bool) {
        return IERC20Minimal(asset).balanceOf(address(this)) >= totalLiability[asset];
    }

    function reconciliation(address asset)
        external
        view
        returns (uint256 balance, uint256 liability, uint256 surplus)
    {
        balance = IERC20Minimal(asset).balanceOf(address(this));
        liability = totalLiability[asset];
        if (balance > liability) surplus = balance - liability;
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

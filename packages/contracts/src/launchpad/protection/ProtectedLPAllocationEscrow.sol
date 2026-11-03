// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { ProtocolAccess } from "../../access/ProtocolAccess.sol";
import { DammPool } from "../../core/DammPool.sol";
import { DlmmPool } from "../../core/DlmmPool.sol";
import { UUPSUpgradeable } from "../../proxy/UUPSUpgradeable.sol";
import { ReentrancyGuard } from "../../security/ReentrancyGuard.sol";

/// @notice Custodies Protected-launch LP receipts with immutable policy-bound unlocks.
contract ProtectedLPAllocationEscrow is ProtocolAccess, UUPSUpgradeable, ReentrancyGuard {
    bytes32 public constant MANAGER_ROLE = keccak256("ZKBLAST_PROTECTED_GRADUATION_MANAGER_ROLE");

    error AllocationAlreadyRegistered();
    error AllocationUnavailable();
    error InvalidAllocation();
    error Locked();
    error UnauthorizedClaim();

    struct Allocation {
        address pool;
        address creator;
        address protocolRecipient;
        bytes32 policyHash;
        uint256 policyId;
        uint128 creatorShares;
        uint128 protocolShares;
        uint64 creatorUnlockAt;
        int24 binId;
        bool isDlmm;
        bool creatorClaimed;
        bool protocolClaimed;
    }

    mapping(bytes32 migrationId => Allocation allocation) public allocations;
    mapping(bytes32 custodyKey => uint256 shares) public accountedShares;

    event ProtectedAllocationRegistered(
        bytes32 indexed migrationId,
        address indexed pool,
        bytes32 indexed policyHash,
        uint256 policyId,
        address creator,
        address protocolRecipient,
        uint256 creatorShares,
        uint256 protocolShares,
        uint64 creatorUnlockAt,
        int24 binId,
        bool isDlmm
    );
    event ProtectedAllocationClaimed(
        bytes32 indexed migrationId,
        address indexed recipient,
        bool creatorAllocation,
        uint256 shares,
        uint256 amount0,
        uint256 amount1
    );

    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address upgrader) external initializer {
        __ProtocolAccess_init(admin, upgrader);
    }

    function registerDammAllocation(
        bytes32 migrationId,
        DammPool pool,
        uint256 policyId,
        bytes32 policyHash,
        address creator,
        address protocolRecipient,
        uint256 creatorShares,
        uint256 protocolShares,
        uint64 creatorUnlockAt,
        uint256 minimumTotalShares
    ) external onlyRole(MANAGER_ROLE) {
        _register(
            migrationId,
            address(pool),
            policyId,
            policyHash,
            creator,
            protocolRecipient,
            creatorShares,
            protocolShares,
            creatorUnlockAt,
            0,
            false,
            pool.sharesOf(address(this)),
            minimumTotalShares
        );
    }

    function registerDlmmAllocation(
        bytes32 migrationId,
        DlmmPool pool,
        int24 binId,
        uint256 policyId,
        bytes32 policyHash,
        address creator,
        address protocolRecipient,
        uint256 creatorShares,
        uint256 protocolShares,
        uint64 creatorUnlockAt,
        uint256 minimumTotalShares
    ) external onlyRole(MANAGER_ROLE) {
        _register(
            migrationId,
            address(pool),
            policyId,
            policyHash,
            creator,
            protocolRecipient,
            creatorShares,
            protocolShares,
            creatorUnlockAt,
            binId,
            true,
            pool.sharesOf(binId, address(this)),
            minimumTotalShares
        );
    }

    function claim(
        bytes32 migrationId,
        bool creatorAllocation,
        uint256 minimumAmount0,
        uint256 minimumAmount1,
        uint256 deadline
    ) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        Allocation storage record = allocations[migrationId];
        if (record.pool == address(0)) revert AllocationUnavailable();
        address recipient;
        uint256 shares;
        if (creatorAllocation) {
            if (msg.sender != record.creator) revert UnauthorizedClaim();
            if (block.timestamp < record.creatorUnlockAt) revert Locked();
            if (record.creatorClaimed) revert AllocationUnavailable();
            record.creatorClaimed = true;
            recipient = record.creator;
            shares = record.creatorShares;
        } else {
            if (msg.sender != record.protocolRecipient) revert UnauthorizedClaim();
            if (record.protocolClaimed) revert AllocationUnavailable();
            record.protocolClaimed = true;
            recipient = record.protocolRecipient;
            shares = record.protocolShares;
        }
        if (shares == 0) revert AllocationUnavailable();
        bytes32 key = _custodyKey(record.pool, record.binId, record.isDlmm);
        accountedShares[key] -= shares;
        if (record.isDlmm) {
            (amount0, amount1) = DlmmPool(record.pool)
                .removeLiquidity(
                    record.binId, shares, minimumAmount0, minimumAmount1, recipient, deadline
                );
        } else {
            (amount0, amount1) = DammPool(record.pool)
                .removeLiquidity(shares, minimumAmount0, minimumAmount1, recipient, deadline);
        }
        emit ProtectedAllocationClaimed(
            migrationId, recipient, creatorAllocation, shares, amount0, amount1
        );
    }

    function getAllocation(bytes32 migrationId) external view returns (Allocation memory) {
        return allocations[migrationId];
    }

    function _register(
        bytes32 migrationId,
        address pool,
        uint256 policyId,
        bytes32 policyHash,
        address creator,
        address protocolRecipient,
        uint256 creatorShares,
        uint256 protocolShares,
        uint64 creatorUnlockAt,
        int24 binId,
        bool isDlmm,
        uint256 receiptBalance,
        uint256 minimumTotalShares
    ) private {
        uint256 totalShares = creatorShares + protocolShares;
        if (
            migrationId == bytes32(0) || pool.code.length == 0 || policyId == 0
                || policyHash == bytes32(0) || creator == address(0)
                || protocolRecipient == address(0) || creatorUnlockAt <= block.timestamp
                || totalShares == 0 || totalShares < minimumTotalShares
                || creatorShares > type(uint128).max || protocolShares > type(uint128).max
        ) revert InvalidAllocation();
        if (allocations[migrationId].pool != address(0)) {
            revert AllocationAlreadyRegistered();
        }
        bytes32 key = _custodyKey(pool, binId, isDlmm);
        if (receiptBalance < accountedShares[key] + totalShares) revert InvalidAllocation();
        accountedShares[key] += totalShares;
        allocations[migrationId] = Allocation({
            pool: pool,
            creator: creator,
            protocolRecipient: protocolRecipient,
            policyHash: policyHash,
            policyId: policyId,
            creatorShares: uint128(creatorShares),
            protocolShares: uint128(protocolShares),
            creatorUnlockAt: creatorUnlockAt,
            binId: binId,
            isDlmm: isDlmm,
            creatorClaimed: false,
            protocolClaimed: false
        });
        emit ProtectedAllocationRegistered(
            migrationId,
            pool,
            policyHash,
            policyId,
            creator,
            protocolRecipient,
            creatorShares,
            protocolShares,
            creatorUnlockAt,
            binId,
            isDlmm
        );
    }

    function _custodyKey(address pool, int24 binId, bool isDlmm) private pure returns (bytes32) {
        return keccak256(abi.encode(pool, isDlmm ? binId : int24(0), isDlmm));
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

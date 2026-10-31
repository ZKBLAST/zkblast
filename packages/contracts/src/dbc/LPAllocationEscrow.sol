// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { DammPool } from "../core/DammPool.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";

/// @notice Holds non-transferable DAMM shares and releases their underlying assets
///         only to the immutable recipients recorded at graduation.
contract LPAllocationEscrow is ProtocolAccess, UUPSUpgradeable {
    bytes32 public constant MANAGER_ROLE = keccak256("ZKBLAST_DBC_GRADUATION_MANAGER_ROLE");

    error AllocationAlreadyRegistered();
    error AllocationUnavailable();
    error InvalidAllocation();
    error Locked();
    error UnauthorizedClaim();

    struct Allocation {
        address pool;
        address creator;
        address protocolRecipient;
        uint128 creatorShares;
        uint128 protocolShares;
        uint64 creatorUnlockAt;
        bool creatorClaimed;
        bool protocolClaimed;
    }

    mapping(bytes32 migrationId => Allocation allocation) public allocations;

    event AllocationRegistered(
        bytes32 indexed migrationId,
        address indexed pool,
        address creator,
        address protocolRecipient,
        uint256 creatorShares,
        uint256 protocolShares,
        uint64 creatorUnlockAt
    );
    event AllocationClaimed(
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

    function registerAllocation(
        bytes32 migrationId,
        DammPool pool,
        address creator,
        address protocolRecipient,
        uint256 creatorShares,
        uint256 protocolShares,
        uint64 creatorUnlockAt
    ) external onlyRole(MANAGER_ROLE) {
        if (
            migrationId == bytes32(0) || address(pool) == address(0) || creator == address(0)
                || protocolRecipient == address(0) || creatorShares + protocolShares == 0
                || creatorShares > type(uint128).max || protocolShares > type(uint128).max
                || pool.sharesOf(address(this)) < creatorShares + protocolShares
        ) revert InvalidAllocation();
        if (allocations[migrationId].pool != address(0)) revert AllocationAlreadyRegistered();
        allocations[migrationId] = Allocation({
            pool: address(pool),
            creator: creator,
            protocolRecipient: protocolRecipient,
            creatorShares: uint128(creatorShares),
            protocolShares: uint128(protocolShares),
            creatorUnlockAt: creatorUnlockAt,
            creatorClaimed: false,
            protocolClaimed: false
        });
        emit AllocationRegistered(
            migrationId,
            address(pool),
            creator,
            protocolRecipient,
            creatorShares,
            protocolShares,
            creatorUnlockAt
        );
    }

    function claim(bytes32 migrationId, bool creatorAllocation, uint256 deadline)
        external
        returns (uint256 amount0, uint256 amount1)
    {
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
        (amount0, amount1) =
            DammPool(record.pool).removeLiquidity(shares, 0, 0, recipient, deadline);
        emit AllocationClaimed(
            migrationId, recipient, creatorAllocation, shares, amount0, amount1
        );
    }

    function getAllocation(bytes32 migrationId) external view returns (Allocation memory) {
        return allocations[migrationId];
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

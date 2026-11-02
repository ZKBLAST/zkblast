// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { ILaunchpadRegistry } from "./ILaunchpadRegistry.sol";
import { LaunchpadTypes } from "./LaunchpadTypes.sol";

contract LaunchpadFeeController is ProtocolAccess, UUPSUpgradeable {
    error InvalidFeePolicy();
    error FeeCapExceeded();
    error NotLaunchpadOwner();
    error PoolAlreadySnapshotted();
    error PolicyNotFound();

    uint16 public constant BPS = 10_000;
    uint16 public constant HARD_MAX_TOTAL_TRADE_FEE_BPS = 300;

    struct FeeShares {
        uint16 protocolShareBps;
        uint16 operatorShareBps;
        uint16 creatorShareBps;
        uint16 referralShareBps;
    }

    struct FeePolicy {
        uint16 totalTradeFeeBps;
        FeeShares shares;
        address operatorRecipient;
        uint32 version;
        bool configured;
    }

    struct FeeSnapshot {
        uint256 launchpadId;
        address pool;
        address protocolRecipient;
        address operatorRecipient;
        address creatorRecipient;
        address referralRecipient;
        uint16 totalTradeFeeBps;
        FeeShares shares;
        uint32 policyVersion;
    }

    ILaunchpadRegistry public registry;
    address public protocolRecipient;
    uint16 public globalMaximumTotalTradeFeeBps;
    mapping(uint256 launchpadId => FeePolicy policy) private _policies;
    mapping(address pool => bytes32 snapshotId) public snapshotByPool;
    mapping(bytes32 snapshotId => FeeSnapshot snapshot) private _snapshots;

    event GlobalFeeCapUpdated(uint16 previousCapBps, uint16 capBps);
    event ProtocolRecipientUpdated(address indexed previousRecipient, address indexed recipient);
    event LaunchpadFeePolicyUpdated(
        uint256 indexed launchpadId,
        uint32 indexed version,
        uint16 totalTradeFeeBps,
        FeeShares shares,
        address operatorRecipient
    );
    event FeePolicySnapshotted(
        bytes32 indexed snapshotId,
        uint256 indexed launchpadId,
        address indexed pool,
        uint32 policyVersion
    );

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        address upgrader,
        ILaunchpadRegistry registry_,
        address protocolRecipient_
    ) external initializer {
        if (address(registry_) == address(0) || protocolRecipient_ == address(0)) {
            revert InvalidAccount();
        }
        __ProtocolAccess_init(admin, upgrader);
        registry = registry_;
        protocolRecipient = protocolRecipient_;
        globalMaximumTotalTradeFeeBps = HARD_MAX_TOTAL_TRADE_FEE_BPS;
        emit GlobalFeeCapUpdated(0, HARD_MAX_TOTAL_TRADE_FEE_BPS);
        emit ProtocolRecipientUpdated(address(0), protocolRecipient_);
    }

    function setGlobalMaximumTotalTradeFeeBps(uint16 capBps)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (capBps > HARD_MAX_TOTAL_TRADE_FEE_BPS) revert FeeCapExceeded();
        uint16 previous = globalMaximumTotalTradeFeeBps;
        globalMaximumTotalTradeFeeBps = capBps;
        emit GlobalFeeCapUpdated(previous, capBps);
    }

    function setProtocolRecipient(address recipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (recipient == address(0)) revert InvalidAccount();
        address previous = protocolRecipient;
        protocolRecipient = recipient;
        emit ProtocolRecipientUpdated(previous, recipient);
    }

    function setLaunchpadFeePolicy(
        uint256 launchpadId,
        uint16 totalTradeFeeBps,
        FeeShares calldata shares,
        address operatorRecipient
    ) external {
        LaunchpadTypes.Record memory item = registry.launchpad(launchpadId);
        if (msg.sender != item.owner) revert NotLaunchpadOwner();
        _validate(totalTradeFeeBps, shares, operatorRecipient);
        FeePolicy storage storedPolicy = _policies[launchpadId];
        uint32 version = storedPolicy.version + 1;
        storedPolicy.totalTradeFeeBps = totalTradeFeeBps;
        storedPolicy.shares = shares;
        storedPolicy.operatorRecipient = operatorRecipient;
        storedPolicy.version = version;
        storedPolicy.configured = true;
        emit LaunchpadFeePolicyUpdated(
            launchpadId, version, totalTradeFeeBps, shares, operatorRecipient
        );
    }

    function snapshotPolicy(
        uint256 launchpadId,
        address pool,
        address creatorRecipient,
        address referralRecipient
    ) external onlyRole(FACTORY_ROLE) returns (bytes32 snapshotId) {
        if (pool == address(0) || creatorRecipient == address(0)) revert InvalidAccount();
        if (snapshotByPool[pool] != bytes32(0)) revert PoolAlreadySnapshotted();
        FeePolicy storage storedPolicy = _policy(launchpadId);
        if (storedPolicy.shares.referralShareBps == 0) {
            referralRecipient = address(0);
        } else if (referralRecipient == address(0)) {
            revert InvalidFeePolicy();
        }
        snapshotId = keccak256(
            abi.encode(block.chainid, address(this), launchpadId, pool, storedPolicy.version)
        );
        _snapshots[snapshotId] = FeeSnapshot({
            launchpadId: launchpadId,
            pool: pool,
            protocolRecipient: protocolRecipient,
            operatorRecipient: storedPolicy.operatorRecipient,
            creatorRecipient: creatorRecipient,
            referralRecipient: referralRecipient,
            totalTradeFeeBps: storedPolicy.totalTradeFeeBps,
            shares: storedPolicy.shares,
            policyVersion: storedPolicy.version
        });
        snapshotByPool[pool] = snapshotId;
        emit FeePolicySnapshotted(snapshotId, launchpadId, pool, storedPolicy.version);
    }

    function policy(uint256 launchpadId) external view returns (FeePolicy memory) {
        return _policy(launchpadId);
    }

    function snapshot(bytes32 snapshotId) external view returns (FeeSnapshot memory item) {
        item = _snapshots[snapshotId];
        if (item.pool == address(0)) revert PolicyNotFound();
    }

    function _validate(
        uint16 totalTradeFeeBps,
        FeeShares calldata shares,
        address operatorRecipient
    ) private view {
        if (totalTradeFeeBps > globalMaximumTotalTradeFeeBps) revert FeeCapExceeded();
        uint256 sum = uint256(shares.protocolShareBps) + shares.operatorShareBps
            + shares.creatorShareBps + shares.referralShareBps;
        if (sum != BPS || operatorRecipient == address(0)) revert InvalidFeePolicy();
    }

    function _policy(uint256 launchpadId) private view returns (FeePolicy storage item) {
        item = _policies[launchpadId];
        if (!item.configured) revert PolicyNotFound();
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

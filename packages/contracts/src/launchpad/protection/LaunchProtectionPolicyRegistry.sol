// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { ProtocolAccess } from "../../access/ProtocolAccess.sol";
import { UUPSUpgradeable } from "../../proxy/UUPSUpgradeable.sol";

/// @notice Immutable, versioned policy catalog for newly created Protected Launches.
contract LaunchProtectionPolicyRegistry is ProtocolAccess, UUPSUpgradeable {
    error InvalidPolicy();
    error PolicyNotFound();

    bytes32 public constant POLICY_ADMIN_ROLE = keccak256("ZKBLAST_PROTECTION_POLICY_ADMIN_ROLE");
    bytes32 public constant POLICY_CONSUMER_ROLE =
        keccak256("ZKBLAST_PROTECTION_POLICY_CONSUMER_ROLE");

    uint16 public constant BPS = 10_000;
    uint16 public constant MAX_LAUNCH_FEE_BPS = 500;
    uint32 public constant MAX_PROTECTION_BLOCKS = 2_000_000;
    uint64 public constant MAX_LP_LOCK_SECONDS = 10 * 365 days;

    struct PolicyInput {
        bytes32 familyId;
        uint32 protectionBlocks;
        uint16 maxBuyBpsPerTransaction;
        uint16 maxBuyBpsPerAddress;
        uint16 initialFeeBps;
        uint16 baseFeeBps;
        uint64 lpLockSeconds;
        bool batchMode;
    }

    struct Policy {
        bytes32 familyId;
        bytes32 policyHash;
        uint32 protectionBlocks;
        uint16 maxBuyBpsPerTransaction;
        uint16 maxBuyBpsPerAddress;
        uint16 initialFeeBps;
        uint16 baseFeeBps;
        uint64 lpLockSeconds;
        uint32 version;
        bool batchMode;
        bool enabled;
        bool used;
    }

    uint256 public policyCount;
    mapping(bytes32 familyId => uint32 version) public latestVersion;
    mapping(uint256 policyId => Policy policy) private _policies;

    event ProtectionPolicyCreated(
        uint256 indexed policyId,
        bytes32 indexed familyId,
        uint32 indexed version,
        bytes32 policyHash
    );
    event ProtectionPolicyStatusUpdated(uint256 indexed policyId, bool enabled);
    event ProtectionPolicyUsed(uint256 indexed policyId);

    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address upgrader, address policyAdmin) external initializer {
        if (policyAdmin == address(0)) revert InvalidAccount();
        __ProtocolAccess_init(admin, upgrader);
        _setRole(POLICY_ADMIN_ROLE, policyAdmin, true);
    }

    function createPolicy(PolicyInput calldata input)
        external
        onlyRole(POLICY_ADMIN_ROLE)
        returns (uint256 policyId)
    {
        _validate(input);
        uint32 version = latestVersion[input.familyId] + 1;
        latestVersion[input.familyId] = version;
        policyId = ++policyCount;
        bytes32 policyHash = keccak256(abi.encode(block.chainid, address(this), input));
        _policies[policyId] = Policy({
            familyId: input.familyId,
            policyHash: policyHash,
            protectionBlocks: input.protectionBlocks,
            maxBuyBpsPerTransaction: input.maxBuyBpsPerTransaction,
            maxBuyBpsPerAddress: input.maxBuyBpsPerAddress,
            initialFeeBps: input.initialFeeBps,
            baseFeeBps: input.baseFeeBps,
            lpLockSeconds: input.lpLockSeconds,
            version: version,
            batchMode: input.batchMode,
            enabled: true,
            used: false
        });
        emit ProtectionPolicyCreated(policyId, input.familyId, version, policyHash);
    }

    function setPolicyEnabled(uint256 policyId, bool enabled) external onlyRole(POLICY_ADMIN_ROLE) {
        Policy storage item = _policy(policyId);
        item.enabled = enabled;
        emit ProtectionPolicyStatusUpdated(policyId, enabled);
    }

    function markPolicyUsed(uint256 policyId) external onlyRole(POLICY_CONSUMER_ROLE) {
        Policy storage item = _policy(policyId);
        if (!item.enabled) revert InvalidPolicy();
        if (!item.used) {
            item.used = true;
            emit ProtectionPolicyUsed(policyId);
        }
    }

    function policy(uint256 policyId) external view returns (Policy memory) {
        return _policy(policyId);
    }

    function _validate(PolicyInput calldata input) private pure {
        if (
            input.familyId == bytes32(0) || input.protectionBlocks == 0
                || input.protectionBlocks > MAX_PROTECTION_BLOCKS
                || input.maxBuyBpsPerTransaction == 0
                || input.maxBuyBpsPerTransaction > input.maxBuyBpsPerAddress
                || input.maxBuyBpsPerAddress > BPS || input.initialFeeBps < input.baseFeeBps
                || input.initialFeeBps > MAX_LAUNCH_FEE_BPS || input.lpLockSeconds == 0
                || input.lpLockSeconds > MAX_LP_LOCK_SECONDS || input.batchMode
        ) revert InvalidPolicy();
    }

    function _policy(uint256 policyId) private view returns (Policy storage item) {
        item = _policies[policyId];
        if (item.familyId == bytes32(0)) revert PolicyNotFound();
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

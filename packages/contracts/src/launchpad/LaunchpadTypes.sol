// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

library LaunchpadTypes {
    enum Status {
        NONE,
        ACTIVE,
        PAUSED_CREATION,
        DISABLED
    }

    struct Record {
        address owner;
        address pendingOwner;
        address treasury;
        address pendingTreasury;
        address operator;
        bytes32 metadataHash;
        bytes32 slugCommitment;
        uint256 configPresetId;
        uint32 version;
        Status status;
        uint64 createdAt;
        uint64 updatedAt;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../../access/ProtocolAccess.sol";
import { UUPSUpgradeable } from "../../proxy/UUPSUpgradeable.sol";

/// @notice Chain-qualified canonical identity catalog for verified Protected launches.
contract ProtectedLaunchIdentityRegistry is ProtocolAccess, UUPSUpgradeable {
    bytes32 public constant IDENTITY_CONSUMER_ROLE =
        keccak256("ZKBLAST_PROTECTED_IDENTITY_CONSUMER_ROLE");

    error IdentityAlreadyRegistered();
    error InvalidIdentity();

    struct IdentityInput {
        bytes32 launchId;
        address factory;
        address token;
        address pool;
        uint256 launchpadId;
        string name;
        string symbol;
        bytes32 metadataHash;
        bytes32 socialHash;
        uint32 tokenTemplateVersion;
    }

    struct Identity {
        bytes32 canonicalHash;
        bytes32 nameCommitment;
        bytes32 symbolCommitment;
        bytes32 metadataHash;
        bytes32 socialHash;
        bytes32 tokenRuntimeCodeHash;
        address factory;
        address token;
        address pool;
        uint256 launchpadId;
        uint32 tokenTemplateVersion;
        bool duplicateName;
        bool duplicateSymbol;
    }

    mapping(bytes32 launchId => Identity identity) private _identities;
    mapping(bytes32 commitment => bytes32 launchId) public firstLaunchByName;
    mapping(bytes32 commitment => bytes32 launchId) public firstLaunchBySymbol;

    event ProtectedLaunchIdentityRegistered(
        bytes32 indexed launchId,
        bytes32 indexed canonicalHash,
        address indexed token,
        address pool,
        bytes32 nameCommitment,
        bytes32 symbolCommitment,
        bytes32 metadataHash,
        bytes32 socialHash,
        bytes32 tokenRuntimeCodeHash,
        uint256 launchpadId,
        uint32 tokenTemplateVersion,
        bool duplicateName,
        bool duplicateSymbol
    );

    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address upgrader, address consumer) external initializer {
        if (consumer == address(0)) revert InvalidIdentity();
        __ProtocolAccess_init(admin, upgrader);
        _setRole(IDENTITY_CONSUMER_ROLE, consumer, true);
    }

    function registerIdentity(IdentityInput calldata input)
        external
        onlyRole(IDENTITY_CONSUMER_ROLE)
        returns (bytes32 canonicalHash)
    {
        if (
            input.launchId == bytes32(0) || input.factory.code.length == 0
                || input.token.code.length == 0 || input.pool.code.length == 0
                || input.metadataHash == bytes32(0) || input.tokenTemplateVersion == 0
        ) revert InvalidIdentity();
        if (_identities[input.launchId].token != address(0)) {
            revert IdentityAlreadyRegistered();
        }
        bytes32 nameCommitment = keccak256(_normalize(input.name));
        bytes32 symbolCommitment = keccak256(_normalize(input.symbol));
        bytes32 runtimeCodeHash = input.token.codehash;
        canonicalHash = keccak256(
            abi.encode(
                block.chainid,
                input.factory,
                input.launchId,
                input.token,
                input.pool,
                input.launchpadId,
                nameCommitment,
                symbolCommitment,
                input.metadataHash,
                input.socialHash,
                input.tokenTemplateVersion,
                runtimeCodeHash
            )
        );
        bool duplicateName = firstLaunchByName[nameCommitment] != bytes32(0);
        bool duplicateSymbol = firstLaunchBySymbol[symbolCommitment] != bytes32(0);
        if (!duplicateName) firstLaunchByName[nameCommitment] = input.launchId;
        if (!duplicateSymbol) firstLaunchBySymbol[symbolCommitment] = input.launchId;
        _identities[input.launchId] = Identity({
            canonicalHash: canonicalHash,
            nameCommitment: nameCommitment,
            symbolCommitment: symbolCommitment,
            metadataHash: input.metadataHash,
            socialHash: input.socialHash,
            tokenRuntimeCodeHash: runtimeCodeHash,
            factory: input.factory,
            token: input.token,
            pool: input.pool,
            launchpadId: input.launchpadId,
            tokenTemplateVersion: input.tokenTemplateVersion,
            duplicateName: duplicateName,
            duplicateSymbol: duplicateSymbol
        });
        emit ProtectedLaunchIdentityRegistered(
            input.launchId,
            canonicalHash,
            input.token,
            input.pool,
            nameCommitment,
            symbolCommitment,
            input.metadataHash,
            input.socialHash,
            runtimeCodeHash,
            input.launchpadId,
            input.tokenTemplateVersion,
            duplicateName,
            duplicateSymbol
        );
    }

    function identity(bytes32 launchId) external view returns (Identity memory) {
        Identity memory item = _identities[launchId];
        if (item.token == address(0)) revert InvalidIdentity();
        return item;
    }

    function normalizedCommitment(string calldata value) external pure returns (bytes32) {
        return keccak256(_normalize(value));
    }

    function _normalize(string calldata value) private pure returns (bytes memory normalized) {
        bytes calldata source = bytes(value);
        uint256 start = 0;
        while (start < source.length && source[start] == 0x20) ++start;
        uint256 end = source.length;
        while (end > start && source[end - 1] == 0x20) --end;
        if (end == start || end - start > 64) revert InvalidIdentity();
        normalized = new bytes(end - start);
        for (uint256 i; i < normalized.length; ++i) {
            bytes1 character = source[start + i];
            if (character < 0x20 || character > 0x7e) revert InvalidIdentity();
            normalized[i] =
                character >= 0x41 && character <= 0x5a ? bytes1(uint8(character) + 32) : character;
        }
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

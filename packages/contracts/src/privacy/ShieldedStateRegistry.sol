// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";

contract ShieldedStateRegistry is ProtocolAccess, UUPSUpgradeable {
    error InvalidFieldElement();
    error UnauthorizedVault();
    error UnauthorizedConsumer();
    error UnknownRoot();
    error NullifierAlreadySpent();

    uint16 public constant ROOT_HISTORY_SIZE = 256;

    struct RootHistory {
        uint64 count;
        uint16 cursor;
        mapping(uint16 slot => bytes32 root) roots;
        mapping(bytes32 root => uint16 references) references;
    }

    mapping(address vault => bool authorized) public authorizedVault;
    mapping(address consumer => bool authorized) public authorizedConsumer;
    mapping(bytes32 scope => RootHistory history) private _histories;
    mapping(bytes32 scope => mapping(bytes32 nullifier => bool spent)) private _spent;

    event VaultAuthorizationUpdated(address indexed vault, bool authorized);
    event ConsumerAuthorizationUpdated(address indexed consumer, bool authorized);
    event RootRegistered(address indexed vault, uint64 indexed treeVersion, bytes32 indexed root);
    event NullifierConsumed(
        address indexed vault, uint64 indexed treeVersion, bytes32 indexed nullifier
    );

    constructor() {
        _disableInitializers();
    }

    modifier onlyAuthorizedVault() {
        if (!authorizedVault[msg.sender]) revert UnauthorizedVault();
        _;
    }

    function initialize(address admin, address upgrader) external initializer {
        __ProtocolAccess_init(admin, upgrader);
    }

    function setVaultAuthorization(address vault, bool authorized)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (vault == address(0)) revert InvalidAccount();
        authorizedVault[vault] = authorized;
        emit VaultAuthorizationUpdated(vault, authorized);
    }

    function setConsumerAuthorization(address consumer, bool authorized)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (consumer == address(0)) revert InvalidAccount();
        authorizedConsumer[consumer] = authorized;
        emit ConsumerAuthorizationUpdated(consumer, authorized);
    }

    function registerRoot(uint64 treeVersion, bytes32 root) external onlyAuthorizedVault {
        if (treeVersion == 0 || root == bytes32(0)) revert InvalidFieldElement();
        RootHistory storage history = _histories[_scope(msg.sender, treeVersion)];
        bytes32 replaced = history.roots[history.cursor];
        if (replaced != bytes32(0)) {
            unchecked {
                --history.references[replaced];
            }
        }
        history.roots[history.cursor] = root;
        ++history.references[root];
        history.cursor = uint16((uint256(history.cursor) + 1) % ROOT_HISTORY_SIZE);
        if (history.count < ROOT_HISTORY_SIZE) ++history.count;
        emit RootRegistered(msg.sender, treeVersion, root);
    }

    function consumeNullifierFor(address vault, uint64 treeVersion, bytes32 root, bytes32 nullifier)
        external
    {
        if (!authorizedConsumer[msg.sender]) revert UnauthorizedConsumer();
        if (!authorizedVault[vault]) revert UnauthorizedVault();
        if (nullifier == bytes32(0)) revert InvalidFieldElement();
        bytes32 scope = _scope(vault, treeVersion);
        if (_histories[scope].references[root] == 0) revert UnknownRoot();
        if (_spent[scope][nullifier]) revert NullifierAlreadySpent();
        _spent[scope][nullifier] = true;
        emit NullifierConsumed(vault, treeVersion, nullifier);
    }

    function isKnownRoot(address vault, uint64 treeVersion, bytes32 root)
        external
        view
        returns (bool)
    {
        return _histories[_scope(vault, treeVersion)].references[root] != 0;
    }

    function isNullifierSpent(address vault, uint64 treeVersion, bytes32 nullifier)
        external
        view
        returns (bool)
    {
        return _spent[_scope(vault, treeVersion)][nullifier];
    }

    function rootAt(address vault, uint64 treeVersion, uint16 slot)
        external
        view
        returns (bytes32)
    {
        return _histories[_scope(vault, treeVersion)].roots[slot];
    }

    function _scope(address vault, uint64 treeVersion) private pure returns (bytes32) {
        return keccak256(abi.encode(vault, treeVersion));
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

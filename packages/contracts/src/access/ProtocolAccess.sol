// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Initializable } from "../proxy/Initializable.sol";

abstract contract ProtocolAccess is Initializable {
    error InvalidAccount();
    error Unauthorized(bytes32 role, address account);

    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;
    bytes32 public constant UPGRADER_ROLE = keccak256("ZKBLAST_UPGRADER_ROLE");
    bytes32 public constant FACTORY_ROLE = keccak256("ZKBLAST_FACTORY_ROLE");

    mapping(bytes32 role => mapping(address account => bool enabled)) private _roles;

    event RoleUpdated(bytes32 indexed role, address indexed account, bool enabled);

    modifier onlyRole(bytes32 role) {
        if (!_roles[role][msg.sender]) revert Unauthorized(role, msg.sender);
        _;
    }

    function __ProtocolAccess_init(address admin, address upgrader) internal onlyInitializing {
        if (admin == address(0) || upgrader == address(0)) revert InvalidAccount();
        _setRole(DEFAULT_ADMIN_ROLE, admin, true);
        _setRole(UPGRADER_ROLE, upgrader, true);
    }

    function hasRole(bytes32 role, address account) external view returns (bool) {
        return _roles[role][account];
    }

    function setRole(bytes32 role, address account, bool enabled)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (account == address(0)) revert InvalidAccount();
        _setRole(role, account, enabled);
    }

    function _setRole(bytes32 role, address account, bool enabled) internal {
        _roles[role][account] = enabled;
        emit RoleUpdated(role, account, enabled);
    }
}

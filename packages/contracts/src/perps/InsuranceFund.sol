// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { ReentrancyGuard } from "../security/ReentrancyGuard.sol";
import { IERC20Minimal } from "../interfaces/IERC20Minimal.sol";
import { TokenTransfer } from "../libraries/TokenTransfer.sol";

contract InsuranceFund is ProtocolAccess, UUPSUpgradeable, ReentrancyGuard {
    using TokenTransfer for address;

    error InvalidInsuranceConfig();

    bytes32 public constant VAULT_ROLE = keccak256("ZKBLAST_PERP_INSURANCE_VAULT_ROLE");

    address public asset;

    event InsuranceFunded(address indexed sender, uint256 amount);
    event InsuranceCovered(address indexed recipient, uint256 amount);

    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address upgrader, address vault, address asset_)
        external
        initializer
    {
        if (vault == address(0) || asset_.code.length == 0) {
            revert InvalidInsuranceConfig();
        }
        __ProtocolAccess_init(admin, upgrader);
        _setRole(VAULT_ROLE, vault, true);
        asset = asset_;
    }

    function fund(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidInsuranceConfig();
        asset.pullExact(msg.sender, amount);
        emit InsuranceFunded(msg.sender, amount);
    }

    function cover(address recipient, uint256 amount) external nonReentrant onlyRole(VAULT_ROLE) {
        if (recipient == address(0) || amount == 0) revert InvalidInsuranceConfig();
        asset.pushExact(recipient, amount);
        emit InsuranceCovered(recipient, amount);
    }

    function assets() external view returns (uint256) {
        return IERC20Minimal(asset).balanceOf(address(this));
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

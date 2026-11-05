// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20Minimal } from "../interfaces/IERC20Minimal.sol";
import { TokenTransfer } from "../libraries/TokenTransfer.sol";
import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { AssistanceFeeCollector } from "./AssistanceFeeCollector.sol";
import { IAssistanceFundEvents } from "./IAssistanceFundEvents.sol";

/// @notice Timelocked destination controller for the 1% treasury allocation.
contract TreasuryController is ProtocolAccess, UUPSUpgradeable, IAssistanceFundEvents {
    using TokenTransfer for address;

    AssistanceFeeCollector public collector;
    address public recipient;
    bool public paused;

    event TreasuryRecipientUpdated(address indexed previousRecipient, address indexed recipient);
    event TreasuryClaimsPaused(bool paused);
    event UnrelatedTokenRecovered(address indexed asset, address indexed recipient, uint256 amount);

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address governanceTimelock,
        AssistanceFeeCollector collector_,
        address recipient_
    ) external initializer {
        if (
            address(collector_) == address(0) || address(collector_).code.length == 0
                || recipient_ == address(0)
        ) revert InvalidSource();
        __ProtocolAccess_init(governanceTimelock, governanceTimelock);
        collector = collector_;
        recipient = recipient_;
        emit TreasuryRecipientUpdated(address(0), recipient_);
    }

    /// @notice Permissionless trigger; funds can only reach the timelocked recipient.
    function claim(address asset, uint256 amount) external {
        if (paused) revert ExecutionUnavailable();
        collector.releaseTreasury(asset, recipient, amount);
    }

    function setRecipient(address nextRecipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (nextRecipient == address(0)) revert InvalidAsset();
        address previous = recipient;
        recipient = nextRecipient;
        emit TreasuryRecipientUpdated(previous, nextRecipient);
    }

    function setPaused(bool paused_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        paused = paused_;
        emit TreasuryClaimsPaused(paused_);
    }

    /// @notice Recovers only tokens sent directly to this controller; fee claims bypass its custody.
    function recoverUnrelatedToken(address asset, address recoveryRecipient)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        returns (uint256 amount)
    {
        if (recoveryRecipient == address(0)) revert InvalidAsset();
        amount = IERC20Minimal(asset).balanceOf(address(this));
        if (amount == 0) revert InvalidAmount();
        asset.pushExact(recoveryRecipient, amount);
        emit UnrelatedTokenRecovered(asset, recoveryRecipient, amount);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

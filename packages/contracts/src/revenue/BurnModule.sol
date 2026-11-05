// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20Minimal} from "../interfaces/IERC20Minimal.sol";
import {AssistanceFundTypes} from "./AssistanceFundTypes.sol";
import {IAssistanceFundEvents} from "./IAssistanceFundEvents.sol";

interface IBurnableSupplyToken is IERC20Minimal {
    function totalSupply() external view returns (uint256);
    function burn(uint256 amount) external;
}

/// @notice Immutable-token burn boundary used only by the bound Assistance Fund.
contract BurnModule is IAssistanceFundEvents {
    IBurnableSupplyToken public immutable protocolToken;
    address public immutable governanceTimelock;
    address public assistanceFund;

    event AssistanceFundBound(address indexed assistanceFund);

    constructor(IBurnableSupplyToken protocolToken_, address governanceTimelock_) {
        if (
            address(protocolToken_) == address(0) || address(protocolToken_).code.length == 0
                || governanceTimelock_ == address(0) || governanceTimelock_.code.length == 0
        ) revert InvalidSource();
        protocolToken = protocolToken_;
        governanceTimelock = governanceTimelock_;
    }

    function bindAssistanceFund(address assistanceFund_) external {
        if (
            msg.sender != governanceTimelock || assistanceFund != address(0) || assistanceFund_ == address(0)
                || assistanceFund_.code.length == 0
        ) revert InvalidSource();
        assistanceFund = assistanceFund_;
        emit AssistanceFundBound(assistanceFund_);
    }

    function burn(uint256 amount) external returns (uint256 totalSupplyAfter) {
        if (msg.sender != assistanceFund || amount == 0) revert BurnFailed();
        uint256 balanceBefore = protocolToken.balanceOf(address(this));
        uint256 totalSupplyBefore = protocolToken.totalSupply();
        if (balanceBefore < amount || totalSupplyBefore < amount) revert BurnFailed();

        protocolToken.burn(amount);

        uint256 balanceAfter = protocolToken.balanceOf(address(this));
        totalSupplyAfter = protocolToken.totalSupply();
        if (balanceBefore - balanceAfter != amount || totalSupplyBefore - totalSupplyAfter != amount) {
            revert BurnFailed();
        }
        emit ProtocolTokensBurned(
            address(protocolToken),
            AssistanceFundTypes.BurnMethod.TOKEN_BURN,
            amount,
            totalSupplyBefore,
            totalSupplyAfter,
            msg.sender
        );
    }
}

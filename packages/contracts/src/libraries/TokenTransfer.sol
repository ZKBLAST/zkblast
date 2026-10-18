// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20Minimal } from "../interfaces/IERC20Minimal.sol";

library TokenTransfer {
    error TransferFailed();
    error UnsupportedTokenBehavior();

    function pullExact(address token, address sender, uint256 amount) internal {
        uint256 balanceBefore = IERC20Minimal(token).balanceOf(address(this));
        (bool success, bytes memory result) = token.call(
            abi.encodeCall(IERC20Minimal.transferFrom, (sender, address(this), amount))
        );
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) {
            revert TransferFailed();
        }
        if (IERC20Minimal(token).balanceOf(address(this)) - balanceBefore != amount) {
            revert UnsupportedTokenBehavior();
        }
    }

    function push(address token, address recipient, uint256 amount) internal {
        (bool success, bytes memory result) =
            token.call(abi.encodeCall(IERC20Minimal.transfer, (recipient, amount)));
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) {
            revert TransferFailed();
        }
    }

    function pushExact(address token, address recipient, uint256 amount) internal {
        uint256 senderBefore = IERC20Minimal(token).balanceOf(address(this));
        uint256 recipientBefore = IERC20Minimal(token).balanceOf(recipient);
        push(token, recipient, amount);
        if (
            senderBefore - IERC20Minimal(token).balanceOf(address(this)) != amount
                || IERC20Minimal(token).balanceOf(recipient) - recipientBefore != amount
        ) revert UnsupportedTokenBehavior();
    }

    function forceApprove(address token, address spender, uint256 amount) internal {
        if (!_approve(token, spender, amount)) {
            if (!_approve(token, spender, 0) || !_approve(token, spender, amount)) {
                revert TransferFailed();
            }
        }
    }

    function _approve(address token, address spender, uint256 amount) private returns (bool) {
        (bool success, bytes memory result) =
            token.call(abi.encodeCall(IERC20Minimal.approve, (spender, amount)));
        return success && (result.length == 0 || abi.decode(result, (bool)));
    }
}

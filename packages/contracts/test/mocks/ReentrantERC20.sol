// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20Minimal } from "../../src/interfaces/IERC20Minimal.sol";

contract ReentrantERC20 is IERC20Minimal {
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackAttempted;
    bool public callbackSucceeded;
    bool private _insideCallback;

    function mint(address recipient, uint256 amount) external {
        balanceOf[recipient] += amount;
    }

    function configureCallback(address target, bytes calldata data) external {
        require(target != address(0), "zero callback target");
        callbackTarget = target;
        callbackData = data;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        _transfer(msg.sender, recipient, amount);
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount)
        external
        returns (bool)
    {
        uint256 available = allowance[sender][msg.sender];
        if (available != type(uint256).max) allowance[sender][msg.sender] = available - amount;
        _transfer(sender, recipient, amount);
        if (!_insideCallback && callbackTarget != address(0)) {
            _insideCallback = true;
            callbackAttempted = true;
            (callbackSucceeded,) = callbackTarget.call(callbackData);
            _insideCallback = false;
        }
        return true;
    }

    function _transfer(address sender, address recipient, uint256 amount) private {
        balanceOf[sender] -= amount;
        balanceOf[recipient] += amount;
    }
}

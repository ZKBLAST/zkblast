// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20Minimal } from "../interfaces/IERC20Minimal.sol";

/// @notice Fixed-supply token for ZKBLAST public testnet acceptance only.
contract ZkblastTestnetToken is IERC20Minimal {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public immutable totalSupply;
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    event Transfer(address indexed sender, address indexed recipient, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    error InvalidRecipient();

    constructor(string memory name_, string memory symbol_, address owner, uint256 supply) {
        if (owner == address(0)) revert InvalidRecipient();
        name = name_;
        symbol = symbol_;
        totalSupply = supply;
        balanceOf[owner] = supply;
        emit Transfer(address(0), owner, supply);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
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
        if (available != type(uint256).max) {
            allowance[sender][msg.sender] = available - amount;
            emit Approval(sender, msg.sender, allowance[sender][msg.sender]);
        }
        _transfer(sender, recipient, amount);
        return true;
    }

    function _transfer(address sender, address recipient, uint256 amount) private {
        if (recipient == address(0)) revert InvalidRecipient();
        balanceOf[sender] -= amount;
        balanceOf[recipient] += amount;
        emit Transfer(sender, recipient, amount);
    }
}

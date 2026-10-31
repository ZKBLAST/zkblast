// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20Metadata } from "../interfaces/IERC20Metadata.sol";

/// @notice Fixed-supply canonical token created by the ZKBLAST DBC factory.
contract LaunchToken is IERC20Metadata {
    error InsufficientAllowance();
    error InsufficientBalance();
    error InvalidRecipient();
    error InvalidSupply();

    string public name;
    string public symbol;
    string public metadataURI;
    uint8 public constant decimals = 18;
    uint256 public immutable totalSupply;
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    event Transfer(address indexed sender, address indexed recipient, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    constructor(
        string memory name_,
        string memory symbol_,
        string memory metadataURI_,
        uint256 totalSupply_,
        address initialHolder
    ) {
        if (bytes(name_).length == 0 || bytes(symbol_).length == 0 || totalSupply_ == 0) {
            revert InvalidSupply();
        }
        if (initialHolder == address(0)) revert InvalidRecipient();
        name = name_;
        symbol = symbol_;
        metadataURI = metadataURI_;
        totalSupply = totalSupply_;
        balanceOf[initialHolder] = totalSupply_;
        emit Transfer(address(0), initialHolder, totalSupply_);
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
            if (available < amount) revert InsufficientAllowance();
            allowance[sender][msg.sender] = available - amount;
            emit Approval(sender, msg.sender, available - amount);
        }
        _transfer(sender, recipient, amount);
        return true;
    }

    function _transfer(address sender, address recipient, uint256 amount) private {
        if (recipient == address(0)) revert InvalidRecipient();
        uint256 available = balanceOf[sender];
        if (available < amount) revert InsufficientBalance();
        balanceOf[sender] = available - amount;
        balanceOf[recipient] += amount;
        emit Transfer(sender, recipient, amount);
    }
}

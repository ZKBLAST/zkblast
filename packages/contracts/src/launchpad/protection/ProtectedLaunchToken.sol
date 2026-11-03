// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20Metadata } from "../../interfaces/IERC20Metadata.sol";

/// @notice Fixed-supply launch token with immutable early-buy concentration bounds.
contract ProtectedLaunchToken is IERC20Metadata {
    error AlreadyBound();
    error BuyLimitExceeded();
    error InsufficientAllowance();
    error InsufficientBalance();
    error InvalidConfiguration();
    error InvalidRecipient();
    error LaunchNotStarted();
    error Unauthorized();

    uint16 public constant BPS = 10_000;
    uint32 public constant TEMPLATE_VERSION = 1;

    string public name;
    string public symbol;
    string public metadataURI;
    uint8 public constant decimals = 18;
    uint256 public immutable totalSupply;
    address public immutable factory;
    bytes32 public immutable launchId;
    uint256 public immutable policyId;
    bytes32 public immutable policyHash;
    uint32 public immutable protectionBlocks;
    uint16 public immutable maxBuyBpsPerTransaction;
    uint16 public immutable maxBuyBpsPerAddress;
    uint256 public immutable maximumBuyPerTransaction;
    uint256 public immutable maximumBuyPerAddress;

    address public protectedPool;
    uint64 public launchStartBlock;
    mapping(address account => uint256 amount) public purchasedDuringProtection;
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    event Transfer(address indexed sender, address indexed recipient, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event ProtectedPoolBound(
        bytes32 indexed launchId,
        address indexed pool,
        uint64 launchStartBlock,
        uint256 policyId,
        bytes32 policyHash
    );
    event ProtectedPurchaseRecorded(
        address indexed buyer, uint256 amount, uint256 cumulativeAmount
    );

    constructor(
        string memory name_,
        string memory symbol_,
        string memory metadataURI_,
        uint256 totalSupply_,
        address initialHolder,
        address factory_,
        bytes32 launchId_,
        uint256 policyId_,
        bytes32 policyHash_,
        uint32 protectionBlocks_,
        uint16 maxBuyBpsPerTransaction_,
        uint16 maxBuyBpsPerAddress_
    ) {
        if (
            bytes(name_).length == 0 || bytes(symbol_).length == 0 || totalSupply_ == 0
                || initialHolder == address(0) || factory_ == address(0) || launchId_ == bytes32(0)
                || policyId_ == 0 || policyHash_ == bytes32(0) || protectionBlocks_ == 0
                || maxBuyBpsPerTransaction_ == 0 || maxBuyBpsPerTransaction_ > maxBuyBpsPerAddress_
                || maxBuyBpsPerAddress_ > BPS
        ) revert InvalidConfiguration();
        uint256 transactionLimit = totalSupply_ * maxBuyBpsPerTransaction_ / BPS;
        uint256 addressLimit = totalSupply_ * maxBuyBpsPerAddress_ / BPS;
        if (transactionLimit == 0 || addressLimit == 0) revert InvalidConfiguration();

        name = name_;
        symbol = symbol_;
        metadataURI = metadataURI_;
        totalSupply = totalSupply_;
        factory = factory_;
        launchId = launchId_;
        policyId = policyId_;
        policyHash = policyHash_;
        protectionBlocks = protectionBlocks_;
        maxBuyBpsPerTransaction = maxBuyBpsPerTransaction_;
        maxBuyBpsPerAddress = maxBuyBpsPerAddress_;
        maximumBuyPerTransaction = transactionLimit;
        maximumBuyPerAddress = addressLimit;
        balanceOf[initialHolder] = totalSupply_;
        emit Transfer(address(0), initialHolder, totalSupply_);
    }

    function bindProtectedPool(address pool, uint64 startBlock) external {
        if (msg.sender != factory) revert Unauthorized();
        if (protectedPool != address(0)) revert AlreadyBound();
        if (pool == address(0) || pool.code.length == 0 || startBlock < block.number) {
            revert InvalidConfiguration();
        }
        protectedPool = pool;
        launchStartBlock = startBlock;
        emit ProtectedPoolBound(launchId, pool, startBlock, policyId, policyHash);
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

    function protectionActive() public view returns (bool) {
        return protectedPool != address(0) && block.number >= launchStartBlock
            && block.number < uint256(launchStartBlock) + protectionBlocks;
    }

    function remainingProtectedAllocation(address buyer) external view returns (uint256) {
        uint256 purchased = purchasedDuringProtection[buyer];
        return purchased >= maximumBuyPerAddress ? 0 : maximumBuyPerAddress - purchased;
    }

    function _transfer(address sender, address recipient, uint256 amount) private {
        if (recipient == address(0)) revert InvalidRecipient();
        if (sender == protectedPool) _recordProtectedPurchase(recipient, amount);
        uint256 available = balanceOf[sender];
        if (available < amount) revert InsufficientBalance();
        balanceOf[sender] = available - amount;
        balanceOf[recipient] += amount;
        emit Transfer(sender, recipient, amount);
    }

    function _recordProtectedPurchase(address buyer, uint256 amount) private {
        if (block.number < launchStartBlock) revert LaunchNotStarted();
        if (!protectionActive()) return;
        uint256 cumulative = purchasedDuringProtection[buyer] + amount;
        if (amount > maximumBuyPerTransaction || cumulative > maximumBuyPerAddress) {
            revert BuyLimitExceeded();
        }
        purchasedDuringProtection[buyer] = cumulative;
        emit ProtectedPurchaseRecorded(buyer, amount, cumulative);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20Minimal } from "../interfaces/IERC20Minimal.sol";
import { TokenTransfer } from "../libraries/TokenTransfer.sol";
import { ConstantProductMath } from "../math/ConstantProductMath.sol";
import { FullMath } from "../math/FullMath.sol";
import { LiquidityMath } from "../math/LiquidityMath.sol";
import { ReentrancyGuard } from "../security/ReentrancyGuard.sol";
import { PoolKey } from "./PoolTypes.sol";

contract DammPool is ReentrancyGuard {
    using TokenTransfer for address;

    uint256 public constant MINIMUM_LIQUIDITY = 1_000;
    uint24 public constant PROTOCOL_FEE_SHARE_DENOMINATOR = 1_000_000;
    address private constant LOCKED_LIQUIDITY_ACCOUNT = address(1);

    error DeadlineExpired();
    error InsufficientInput();
    error InsufficientLiquidity();
    error SlippageExceeded();
    error Unauthorized();
    error PoolPaused();
    error InvalidRecipient();
    error InvalidAdministrator();
    error InvalidProtocolFeeShare();

    address public immutable factory;
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable feePips;
    address public administrator;
    address public protocolFeeRecipient;
    uint24 public protocolFeeSharePips;
    bool public paused;
    uint112 public reserve0;
    uint112 public reserve1;
    uint128 public protocolFees0;
    uint128 public protocolFees1;
    uint256 public totalShares;
    mapping(address account => uint256 shares) public sharesOf;

    event LiquidityAdded(
        address indexed sender,
        address indexed recipient,
        uint256 amount0,
        uint256 amount1,
        uint256 shares
    );
    event LiquidityRemoved(
        address indexed sender,
        address indexed recipient,
        uint256 amount0,
        uint256 amount1,
        uint256 shares
    );
    event Swap(
        address indexed sender,
        address indexed recipient,
        address indexed tokenIn,
        uint256 amountIn,
        uint256 amountOut,
        uint256 protocolFee
    );
    event ProtocolFeesCollected(address indexed recipient, uint256 amount0, uint256 amount1);
    event PauseUpdated(bool paused);
    event ProtocolFeeConfigurationUpdated(address indexed recipient, uint24 sharePips);

    modifier onlyAdministrator() {
        if (msg.sender != administrator) revert Unauthorized();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert PoolPaused();
        _;
    }

    constructor(PoolKey memory key, address administrator_) {
        if (administrator_ == address(0)) revert InvalidAdministrator();
        factory = msg.sender;
        token0 = key.token0;
        token1 = key.token1;
        feePips = key.feePips;
        administrator = administrator_;
        protocolFeeRecipient = administrator_;
    }

    function addLiquidity(
        uint256 amount0,
        uint256 amount1,
        uint256 minimumShares,
        address recipient,
        uint256 deadline
    ) external nonReentrant whenNotPaused returns (uint256 shares) {
        _validateCall(recipient, deadline);
        if (amount0 == 0 || amount1 == 0) revert InsufficientInput();
        token0.pullExact(msg.sender, amount0);
        token1.pullExact(msg.sender, amount1);

        uint256 supply = totalShares;
        if (supply == 0) {
            uint256 root = LiquidityMath.sqrt(amount0 * amount1);
            if (root <= MINIMUM_LIQUIDITY) revert InsufficientLiquidity();
            shares = root - MINIMUM_LIQUIDITY;
            _mint(LOCKED_LIQUIDITY_ACCOUNT, MINIMUM_LIQUIDITY);
        } else {
            shares = LiquidityMath.proportionalShares(amount0, amount1, reserve0, reserve1, supply);
        }
        if (shares == 0 || shares < minimumShares) revert SlippageExceeded();
        _mint(recipient, shares);
        _updateReserves(uint256(reserve0) + amount0, uint256(reserve1) + amount1);
        emit LiquidityAdded(msg.sender, recipient, amount0, amount1, shares);
    }

    function removeLiquidity(
        uint256 shares,
        uint256 minimumAmount0,
        uint256 minimumAmount1,
        address recipient,
        uint256 deadline
    ) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        _validateCall(recipient, deadline);
        if (shares == 0 || shares > sharesOf[msg.sender]) revert InsufficientLiquidity();
        uint256 supply = totalShares;
        amount0 = FullMath.mulDiv(shares, reserve0, supply);
        amount1 = FullMath.mulDiv(shares, reserve1, supply);
        if (amount0 < minimumAmount0 || amount1 < minimumAmount1) revert SlippageExceeded();
        sharesOf[msg.sender] -= shares;
        totalShares = supply - shares;
        _updateReserves(uint256(reserve0) - amount0, uint256(reserve1) - amount1);
        token0.push(recipient, amount0);
        token1.push(recipient, amount1);
        emit LiquidityRemoved(msg.sender, recipient, amount0, amount1, shares);
    }

    function swapExactInput(
        address tokenIn,
        uint256 amountIn,
        uint256 minimumAmountOut,
        address recipient,
        uint256 deadline
    ) external nonReentrant whenNotPaused returns (uint256 amountOut) {
        _validateCall(recipient, deadline);
        bool zeroForOne;
        if (tokenIn == token0) zeroForOne = true;
        else if (tokenIn != token1) revert InsufficientInput();

        (uint256 reserveIn, uint256 reserveOut) = zeroForOne
            ? (uint256(reserve0), uint256(reserve1))
            : (uint256(reserve1), uint256(reserve0));
        uint256 totalFee;
        (amountOut, totalFee) =
            ConstantProductMath.quoteExactInput(amountIn, reserveIn, reserveOut, feePips);
        if (amountOut < minimumAmountOut) revert SlippageExceeded();
        uint256 protocolFee =
            FullMath.mulDiv(totalFee, protocolFeeSharePips, PROTOCOL_FEE_SHARE_DENOMINATOR);

        tokenIn.pullExact(msg.sender, amountIn);
        address tokenOut = zeroForOne ? token1 : token0;
        tokenOut.push(recipient, amountOut);
        if (zeroForOne) {
            protocolFees0 += _toUint128(protocolFee);
            _updateReserves(reserveIn + amountIn - protocolFee, reserveOut - amountOut);
        } else {
            protocolFees1 += _toUint128(protocolFee);
            _updateReserves(reserveOut - amountOut, reserveIn + amountIn - protocolFee);
        }
        emit Swap(msg.sender, recipient, tokenIn, amountIn, amountOut, protocolFee);
    }

    function setPaused(bool paused_) external onlyAdministrator {
        paused = paused_;
        emit PauseUpdated(paused_);
    }

    function setProtocolFeeConfiguration(address recipient, uint24 sharePips)
        external
        onlyAdministrator
    {
        if (recipient == address(0)) revert InvalidRecipient();
        if (sharePips > PROTOCOL_FEE_SHARE_DENOMINATOR) revert InvalidProtocolFeeShare();
        protocolFeeRecipient = recipient;
        protocolFeeSharePips = sharePips;
        emit ProtocolFeeConfigurationUpdated(recipient, sharePips);
    }

    function collectProtocolFees()
        external
        nonReentrant
        returns (uint256 amount0, uint256 amount1)
    {
        if (msg.sender != protocolFeeRecipient) {
            revert Unauthorized();
        }
        amount0 = protocolFees0;
        amount1 = protocolFees1;
        protocolFees0 = 0;
        protocolFees1 = 0;
        if (amount0 != 0) token0.push(msg.sender, amount0);
        if (amount1 != 0) token1.push(msg.sender, amount1);
        emit ProtocolFeesCollected(msg.sender, amount0, amount1);
    }

    function _mint(address recipient, uint256 shares) private {
        sharesOf[recipient] += shares;
        totalShares += shares;
    }

    function _updateReserves(uint256 nextReserve0, uint256 nextReserve1) private {
        if (nextReserve0 > type(uint112).max || nextReserve1 > type(uint112).max) {
            revert InsufficientLiquidity();
        }
        // Bounds are checked immediately above.
        // forge-lint: disable-next-line(unsafe-typecast)
        reserve0 = uint112(nextReserve0);
        // forge-lint: disable-next-line(unsafe-typecast)
        reserve1 = uint112(nextReserve1);
    }

    function _toUint128(uint256 value) private pure returns (uint128 result) {
        if (value > type(uint128).max) revert InsufficientLiquidity();
        // forge-lint: disable-next-line(unsafe-typecast)
        result = uint128(value);
    }

    function _validateCall(address recipient, uint256 deadline) private view {
        // Deadlines intentionally use the current block timestamp and tolerate normal validator drift.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (recipient == address(0)) revert InvalidRecipient();
    }
}

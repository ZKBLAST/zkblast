// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { TokenTransfer } from "../libraries/TokenTransfer.sol";
import { BinPriceMath } from "../math/BinPriceMath.sol";
import { FullMath } from "../math/FullMath.sol";
import { LiquidityMath } from "../math/LiquidityMath.sol";
import { ReentrancyGuard } from "../security/ReentrancyGuard.sol";
import { PoolKey, PoolModel } from "./PoolTypes.sol";

contract DlmmPool is ReentrancyGuard {
    using TokenTransfer for address;

    uint256 public constant MINIMUM_BIN_LIQUIDITY = 1_000;
    uint256 private constant FEE_DENOMINATOR = 1_000_000;
    address private constant LOCKED_LIQUIDITY_ACCOUNT = address(1);

    struct Bin {
        uint128 reserve0;
        uint128 reserve1;
        uint256 totalShares;
    }

    struct SwapState {
        uint256 remaining;
        uint256 amountOut;
        uint256 protocolFee;
        int24 currentBin;
    }

    error DeadlineExpired();
    error InvalidAmount();
    error InvalidBin();
    error InvalidRecipient();
    error InvalidAdministrator();
    error InsufficientLiquidity();
    error PoolPaused();
    error SlippageExceeded();
    error TraversalLimitReached();
    error Unauthorized();

    address public immutable factory;
    address public immutable token0;
    address public immutable token1;
    PoolModel public constant model = PoolModel.DLMM;
    uint24 public immutable feePips;
    uint16 public immutable binStepBps;
    address public administrator;
    address public protocolFeeRecipient;
    uint24 public protocolFeeSharePips;
    bool public paused;
    int24 public activeBin;
    uint128 public protocolFees0;
    uint128 public protocolFees1;
    mapping(int24 binId => Bin bin) private _bins;
    mapping(int24 binId => mapping(address account => uint256 shares)) public sharesOf;

    event BinLiquidityAdded(
        int24 indexed binId,
        address indexed sender,
        address indexed recipient,
        uint256 amount0,
        uint256 amount1,
        uint256 shares
    );
    event BinLiquidityRemoved(
        int24 indexed binId,
        address indexed sender,
        address indexed recipient,
        uint256 amount0,
        uint256 amount1,
        uint256 shares
    );
    event Swap(
        address indexed sender,
        address indexed recipient,
        bool token0ToToken1,
        uint256 amountIn,
        uint256 amountOut,
        uint256 protocolFee,
        int24 finalActiveBin
    );
    event ActiveBinUpdated(int24 indexed activeBin);
    event PauseUpdated(bool paused);
    event ProtocolFeeConfigurationUpdated(address indexed recipient, uint24 sharePips);
    event ProtocolFeesCollected(address indexed recipient, uint256 amount0, uint256 amount1);

    modifier onlyAdministrator() {
        if (msg.sender != administrator) revert Unauthorized();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert PoolPaused();
        _;
    }

    constructor(PoolKey memory key, address administrator_, int24 initialActiveBin) {
        if (key.model != PoolModel.DLMM || key.binStepBps == 0) revert InvalidBin();
        if (administrator_ == address(0)) revert InvalidAdministrator();
        factory = msg.sender;
        token0 = key.token0;
        token1 = key.token1;
        feePips = key.feePips;
        binStepBps = key.binStepBps;
        administrator = administrator_;
        protocolFeeRecipient = administrator_;
        activeBin = initialActiveBin;
        BinPriceMath.priceFromBin(initialActiveBin, key.binStepBps);
    }

    function binState(int24 binId)
        external
        view
        returns (uint128 reserve0, uint128 reserve1, uint256 totalShares, uint256 priceX18)
    {
        Bin storage bin = _bins[binId];
        return (
            bin.reserve0,
            bin.reserve1,
            bin.totalShares,
            BinPriceMath.priceFromBin(binId, binStepBps)
        );
    }

    function addLiquidity(
        int24 binId,
        uint256 amount0,
        uint256 amount1,
        uint256 minimumShares,
        address recipient,
        uint256 deadline
    ) external nonReentrant whenNotPaused returns (uint256 shares) {
        _validateCall(recipient, deadline);
        if (amount0 == 0 || amount1 == 0) revert InvalidAmount();
        BinPriceMath.priceFromBin(binId, binStepBps);
        Bin storage bin = _bins[binId];
        token0.pullExact(msg.sender, amount0);
        token1.pullExact(msg.sender, amount1);

        if (bin.totalShares == 0) {
            uint256 root = LiquidityMath.sqrt(amount0 * amount1);
            if (root <= MINIMUM_BIN_LIQUIDITY) revert InsufficientLiquidity();
            shares = root - MINIMUM_BIN_LIQUIDITY;
            sharesOf[binId][LOCKED_LIQUIDITY_ACCOUNT] = MINIMUM_BIN_LIQUIDITY;
            bin.totalShares = MINIMUM_BIN_LIQUIDITY;
        } else {
            shares = LiquidityMath.proportionalShares(
                amount0, amount1, bin.reserve0, bin.reserve1, bin.totalShares
            );
        }
        if (shares == 0 || shares < minimumShares) revert SlippageExceeded();
        sharesOf[binId][recipient] += shares;
        bin.totalShares += shares;
        _setBinReserves(bin, uint256(bin.reserve0) + amount0, uint256(bin.reserve1) + amount1);
        emit BinLiquidityAdded(binId, msg.sender, recipient, amount0, amount1, shares);
    }

    function removeLiquidity(
        int24 binId,
        uint256 shares,
        uint256 minimumAmount0,
        uint256 minimumAmount1,
        address recipient,
        uint256 deadline
    ) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        _validateCall(recipient, deadline);
        Bin storage bin = _bins[binId];
        if (shares == 0 || shares > sharesOf[binId][msg.sender]) revert InsufficientLiquidity();
        amount0 = FullMath.mulDiv(shares, bin.reserve0, bin.totalShares);
        amount1 = FullMath.mulDiv(shares, bin.reserve1, bin.totalShares);
        if (amount0 < minimumAmount0 || amount1 < minimumAmount1) revert SlippageExceeded();
        sharesOf[binId][msg.sender] -= shares;
        bin.totalShares -= shares;
        _setBinReserves(bin, uint256(bin.reserve0) - amount0, uint256(bin.reserve1) - amount1);
        token0.push(recipient, amount0);
        token1.push(recipient, amount1);
        emit BinLiquidityRemoved(binId, msg.sender, recipient, amount0, amount1, shares);
    }

    function swapExactInput(
        bool token0ToToken1,
        uint256 amountIn,
        uint256 minimumAmountOut,
        uint16 maximumBinCrossings,
        address recipient,
        uint256 deadline
    ) external nonReentrant whenNotPaused returns (uint256 amountOut, uint256 amountConsumed) {
        _validateCall(recipient, deadline);
        if (amountIn == 0 || maximumBinCrossings == 0) revert InvalidAmount();
        address tokenIn = token0ToToken1 ? token0 : token1;
        tokenIn.pullExact(msg.sender, amountIn);

        uint256 protocolFeeTotal;
        int24 currentBin;
        (amountOut, amountConsumed, protocolFeeTotal, currentBin) =
            _executeSwap(token0ToToken1, amountIn, maximumBinCrossings);
        if (amountConsumed == 0) revert InsufficientLiquidity();
        if (amountOut < minimumAmountOut) revert SlippageExceeded();
        activeBin = currentBin;
        (token0ToToken1 ? token1 : token0).push(recipient, amountOut);
        emit ActiveBinUpdated(currentBin);
        emit Swap(
            msg.sender,
            recipient,
            token0ToToken1,
            amountConsumed,
            amountOut,
            protocolFeeTotal,
            currentBin
        );
    }

    function _executeSwap(bool token0ToToken1, uint256 amountIn, uint16 maximumBinCrossings)
        private
        returns (uint256 amountOut, uint256 amountConsumed, uint256 protocolFee, int24 currentBin)
    {
        SwapState memory state = SwapState(amountIn, 0, 0, activeBin);
        for (uint16 crossed; crossed < maximumBinCrossings && state.remaining != 0; ++crossed) {
            (uint256 consumed, uint256 output, uint256 binProtocolFee) =
                _consumeBin(state.currentBin, token0ToToken1, state.remaining);
            state.remaining -= consumed;
            state.amountOut += output;
            state.protocolFee += binProtocolFee;
            if (state.remaining != 0) {
                state.currentBin = token0ToToken1 ? state.currentBin - 1 : state.currentBin + 1;
            }
        }
        if (state.remaining != 0) revert TraversalLimitReached();
        return (state.amountOut, amountIn - state.remaining, state.protocolFee, state.currentBin);
    }

    function setPaused(bool paused_) external onlyAdministrator {
        paused = paused_;
        emit PauseUpdated(paused_);
    }

    function setProtocolFeeConfiguration(address recipient, uint24 sharePips)
        external
        onlyAdministrator
    {
        if (recipient == address(0) || sharePips > FEE_DENOMINATOR) {
            revert InvalidRecipient();
        }
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

    function _consumeBin(int24 binId, bool token0ToToken1, uint256 availableInput)
        private
        returns (uint256 consumed, uint256 output, uint256 protocolFee)
    {
        Bin storage bin = _bins[binId];
        uint256 outputReserve = token0ToToken1 ? bin.reserve1 : bin.reserve0;
        if (outputReserve == 0) return (0, 0, 0);
        uint256 priceX18 = BinPriceMath.priceFromBin(binId, binStepBps);
        uint256 fee = FullMath.mulDivRoundingUp(availableInput, feePips, FEE_DENOMINATOR);
        uint256 netInput = availableInput - fee;
        output = BinPriceMath.quoteAtPrice(netInput, priceX18, token0ToToken1);
        if (output > outputReserve) {
            output = outputReserve;
            netInput = token0ToToken1
                ? FullMath.mulDivRoundingUp(output, 1e18, priceX18)
                : FullMath.mulDivRoundingUp(output, priceX18, 1e18);
            consumed =
                FullMath.mulDivRoundingUp(netInput, FEE_DENOMINATOR, FEE_DENOMINATOR - feePips);
            fee = consumed - netInput;
        } else {
            consumed = availableInput;
        }
        protocolFee = FullMath.mulDiv(fee, protocolFeeSharePips, FEE_DENOMINATOR);
        if (token0ToToken1) {
            protocolFees0 += _toUint128(protocolFee);
            _setBinReserves(
                bin, uint256(bin.reserve0) + consumed - protocolFee, outputReserve - output
            );
        } else {
            protocolFees1 += _toUint128(protocolFee);
            _setBinReserves(
                bin, outputReserve - output, uint256(bin.reserve1) + consumed - protocolFee
            );
        }
    }

    function _setBinReserves(Bin storage bin, uint256 nextReserve0, uint256 nextReserve1) private {
        if (nextReserve0 > type(uint128).max || nextReserve1 > type(uint128).max) {
            revert InsufficientLiquidity();
        }
        // Bounds are checked immediately above.
        // forge-lint: disable-next-line(unsafe-typecast)
        bin.reserve0 = uint128(nextReserve0);
        // forge-lint: disable-next-line(unsafe-typecast)
        bin.reserve1 = uint128(nextReserve1);
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

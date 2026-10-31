// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20Minimal } from "../interfaces/IERC20Minimal.sol";
import { TokenTransfer } from "../libraries/TokenTransfer.sol";
import { FullMath } from "../math/FullMath.sol";
import { ReentrancyGuard } from "../security/ReentrancyGuard.sol";
import { BondingCurveMath } from "./BondingCurveMath.sol";
import { DbcTypes } from "./DbcTypes.sol";
import { DbcConfigStorage } from "./DbcConfigStorage.sol";
import { IDbcEvents } from "./IDbcEvents.sol";
import { SegmentedBondingCurveMath } from "./SegmentedBondingCurveMath.sol";

/// @notice Per-launch escrow and lifecycle container. Trading is added in Slice D04.
contract VirtualPool is IDbcEvents, ReentrancyGuard {
    using DbcConfigStorage for DbcTypes.TemplateConfig;
    using TokenTransfer for address;
    error AlreadyActivated();
    error CurveCapacityExceeded();
    error InvalidConfiguration();
    error InvalidInventory();
    error InvalidLifecycle();
    error InvalidRecipient();
    error SlippageExceeded();
    error DeadlineExpired();
    error InsufficientReserve();
    error Unauthorized();

    struct BuyQuote {
        uint256 grossQuoteConsumedRaw;
        uint256 netQuoteRaw;
        uint256 baseOutRaw;
        uint256 feeRaw;
        uint256 finalPriceX18;
    }

    struct SellQuote {
        uint256 baseInRaw;
        uint256 grossQuoteOutRaw;
        uint256 netQuoteOutRaw;
        uint256 feeRaw;
        uint256 finalPriceX18;
    }

    bytes32 public immutable launchId;
    uint256 public immutable templateId;
    address public immutable factory;
    address public immutable creator;
    address public immutable baseToken;
    address public immutable quoteToken;
    address public graduationManager;
    DbcTypes.Lifecycle public lifecycle;
    DbcTypes.PoolAccounting public accounting;
    DbcTypes.GraduationState public graduation;
    DbcTypes.TemplateConfig private _config;

    constructor(
        bytes32 launchId_,
        uint256 templateId_,
        address factory_,
        address creator_,
        address baseToken_,
        DbcTypes.TemplateConfig memory config_
    ) {
        if (
            launchId_ == bytes32(0) || factory_ == address(0) || creator_ == address(0)
                || baseToken_ == address(0) || config_.quoteToken == address(0)
        ) revert InvalidConfiguration();
        launchId = launchId_;
        templateId = templateId_;
        factory = factory_;
        creator = creator_;
        baseToken = baseToken_;
        quoteToken = config_.quoteToken;
        _config.write(config_);
        lifecycle = DbcTypes.Lifecycle.DRAFT;
    }

    function activate() external {
        if (msg.sender != factory) revert Unauthorized();
        if (lifecycle != DbcTypes.Lifecycle.DRAFT) revert AlreadyActivated();
        if (IERC20Minimal(baseToken).balanceOf(address(this)) != _config.baseInventoryRaw) {
            revert InvalidInventory();
        }
        lifecycle = DbcTypes.Lifecycle.ACTIVE;
        emit LifecycleUpdated(launchId, DbcTypes.Lifecycle.DRAFT, DbcTypes.Lifecycle.ACTIVE);
    }

    function quoteBuyExactInput(uint256 grossQuoteInRaw)
        public
        view
        returns (BuyQuote memory quote)
    {
        if (grossQuoteInRaw == 0 || lifecycle != DbcTypes.Lifecycle.ACTIVE) {
            revert InvalidLifecycle();
        }
        uint256 remainingNet =
            uint256(_config.graduationThresholdRaw) - accounting.realQuoteReserveRaw;
        uint256 fee = BondingCurveMath.feeOnGross(grossQuoteInRaw, _config.fees.tradeFeeBps);
        uint256 netQuote = grossQuoteInRaw - fee;
        uint256 consumed = grossQuoteInRaw;
        if (netQuote > remainingNet) {
            consumed = _grossForNetCap(grossQuoteInRaw, remainingNet);
            fee = BondingCurveMath.feeOnGross(consumed, _config.fees.tradeFeeBps);
            netQuote = consumed - fee;
        }
        uint256 netQuoteX18 = BondingCurveMath.normalizeToX18(netQuote, _config.quoteDecimals);
        uint256 soldX18 =
            BondingCurveMath.normalizeToX18(accounting.baseSoldRaw, _config.baseDecimals);
        uint256 baseOutX18 =
            SegmentedBondingCurveMath.baseOutForNetQuote(_config.curve, soldX18, netQuoteX18);
        quote = BuyQuote({
            grossQuoteConsumedRaw: consumed,
            netQuoteRaw: netQuote,
            baseOutRaw: BondingCurveMath.denormalizeDown(baseOutX18, _config.baseDecimals),
            feeRaw: fee,
            finalPriceX18: SegmentedBondingCurveMath.marginalPrice(
                _config.curve, soldX18 + baseOutX18
            )
        });
    }

    function buyExactInput(
        uint256 grossQuoteInRaw,
        uint256 minimumBaseOutRaw,
        uint256 maximumPriceX18,
        address recipient,
        uint256 deadline
    ) external nonReentrant returns (BuyQuote memory quote) {
        _validateExecution(recipient, deadline);
        quote = quoteBuyExactInput(grossQuoteInRaw);
        if (
            quote.baseOutRaw == 0 || quote.baseOutRaw < minimumBaseOutRaw
                || (maximumPriceX18 != 0 && quote.finalPriceX18 > maximumPriceX18)
        ) revert SlippageExceeded();
        _settleBuy(quote, recipient);
    }

    function quoteBuyExactOutput(uint256 baseOutRaw) public view returns (BuyQuote memory quote) {
        if (baseOutRaw == 0 || lifecycle != DbcTypes.Lifecycle.ACTIVE) {
            revert InvalidLifecycle();
        }
        uint256 soldX18 =
            BondingCurveMath.normalizeToX18(accounting.baseSoldRaw, _config.baseDecimals);
        uint256 baseOutX18 = BondingCurveMath.normalizeToX18(baseOutRaw, _config.baseDecimals);
        uint256 netQuoteX18 =
            SegmentedBondingCurveMath.quoteBuyExactBase(_config.curve, soldX18, baseOutX18);
        uint256 netQuoteRaw = BondingCurveMath.denormalizeUp(netQuoteX18, _config.quoteDecimals);
        if (netQuoteRaw > uint256(_config.graduationThresholdRaw) - accounting.realQuoteReserveRaw) revert CurveCapacityExceeded();
        uint256 grossQuoteRaw = _grossForExactNet(netQuoteRaw);
        quote = BuyQuote({
            grossQuoteConsumedRaw: grossQuoteRaw,
            netQuoteRaw: netQuoteRaw,
            baseOutRaw: baseOutRaw,
            feeRaw: grossQuoteRaw - netQuoteRaw,
            finalPriceX18: SegmentedBondingCurveMath.marginalPrice(
                _config.curve, soldX18 + baseOutX18
            )
        });
    }

    function buyExactOutput(
        uint256 baseOutRaw,
        uint256 maximumGrossQuoteInRaw,
        uint256 maximumPriceX18,
        address recipient,
        uint256 deadline
    ) external nonReentrant returns (BuyQuote memory quote) {
        _validateExecution(recipient, deadline);
        quote = quoteBuyExactOutput(baseOutRaw);
        if (
            quote.grossQuoteConsumedRaw > maximumGrossQuoteInRaw
                || (maximumPriceX18 != 0 && quote.finalPriceX18 > maximumPriceX18)
        ) revert SlippageExceeded();
        _settleBuy(quote, recipient);
    }

    function quoteSellExactInput(uint256 baseInRaw) public view returns (SellQuote memory quote) {
        if (
            baseInRaw == 0 || lifecycle != DbcTypes.Lifecycle.ACTIVE
                || baseInRaw > accounting.baseSoldRaw
        ) revert InvalidLifecycle();
        uint256 soldX18 =
            BondingCurveMath.normalizeToX18(accounting.baseSoldRaw, _config.baseDecimals);
        uint256 baseInX18 = BondingCurveMath.normalizeToX18(baseInRaw, _config.baseDecimals);
        uint256 grossQuoteX18 =
            SegmentedBondingCurveMath.quoteSellExactBase(_config.curve, soldX18, baseInX18);
        uint256 grossQuote = BondingCurveMath.denormalizeDown(grossQuoteX18, _config.quoteDecimals);
        uint256 fee = BondingCurveMath.feeOnGross(grossQuote, _config.fees.tradeFeeBps);
        quote = SellQuote({
            baseInRaw: baseInRaw,
            grossQuoteOutRaw: grossQuote,
            netQuoteOutRaw: grossQuote - fee,
            feeRaw: fee,
            finalPriceX18: SegmentedBondingCurveMath.marginalPrice(
                _config.curve, soldX18 - baseInX18
            )
        });
    }

    function sellExactInput(
        uint256 baseInRaw,
        uint256 minimumQuoteOutRaw,
        uint256 minimumPriceX18,
        address recipient,
        uint256 deadline
    ) external nonReentrant returns (SellQuote memory quote) {
        _validateExecution(recipient, deadline);
        quote = quoteSellExactInput(baseInRaw);
        if (
            quote.netQuoteOutRaw == 0 || quote.netQuoteOutRaw < minimumQuoteOutRaw
                || (minimumPriceX18 != 0 && quote.finalPriceX18 < minimumPriceX18)
        ) revert SlippageExceeded();
        if (quote.grossQuoteOutRaw > accounting.realQuoteReserveRaw) {
            revert InsufficientReserve();
        }
        _settleSell(quote, recipient);
    }

    function quoteSellExactOutput(uint256 netQuoteOutRaw)
        public
        view
        returns (SellQuote memory quote)
    {
        if (netQuoteOutRaw == 0 || lifecycle != DbcTypes.Lifecycle.ACTIVE) {
            revert InvalidLifecycle();
        }
        uint256 requiredGrossRaw = _grossForExactNet(netQuoteOutRaw);
        if (requiredGrossRaw > accounting.realQuoteReserveRaw) revert InsufficientReserve();
        uint256 soldX18 =
            BondingCurveMath.normalizeToX18(accounting.baseSoldRaw, _config.baseDecimals);
        uint256 requiredGrossX18 =
            BondingCurveMath.normalizeToX18(requiredGrossRaw, _config.quoteDecimals);
        uint256 baseInX18 = SegmentedBondingCurveMath.baseInForGrossQuote(
            _config.curve, soldX18, requiredGrossX18
        );
        uint256 baseInRaw = BondingCurveMath.denormalizeUp(baseInX18, _config.baseDecimals);
        uint256 actualGrossX18 =
            SegmentedBondingCurveMath.quoteSellExactBase(_config.curve, soldX18, baseInX18);
        uint256 actualGrossRaw =
            BondingCurveMath.denormalizeDown(actualGrossX18, _config.quoteDecimals);
        uint256 fee = BondingCurveMath.feeOnGross(actualGrossRaw, _config.fees.tradeFeeBps);
        quote = SellQuote({
            baseInRaw: baseInRaw,
            grossQuoteOutRaw: actualGrossRaw,
            netQuoteOutRaw: actualGrossRaw - fee,
            feeRaw: fee,
            finalPriceX18: SegmentedBondingCurveMath.marginalPrice(
                _config.curve, soldX18 - baseInX18
            )
        });
        if (quote.netQuoteOutRaw < netQuoteOutRaw) revert InvalidInventory();
    }

    function sellExactOutput(
        uint256 netQuoteOutRaw,
        uint256 maximumBaseInRaw,
        uint256 minimumPriceX18,
        address recipient,
        uint256 deadline
    ) external nonReentrant returns (SellQuote memory quote) {
        _validateExecution(recipient, deadline);
        quote = quoteSellExactOutput(netQuoteOutRaw);
        if (
            quote.baseInRaw > maximumBaseInRaw
                || (minimumPriceX18 != 0 && quote.finalPriceX18 < minimumPriceX18)
        ) revert SlippageExceeded();
        _settleSell(quote, recipient);
    }

    function claimFees(uint8 allocation) external nonReentrant returns (uint256 amount) {
        address recipient;
        if (allocation == 0) {
            recipient = creator;
            amount = accounting.creatorFeeLiabilityRaw;
            accounting.creatorFeeLiabilityRaw = 0;
        } else if (allocation == 1 && _config.partnerFeeRecipient != address(0)) {
            recipient = _config.partnerFeeRecipient;
            amount = accounting.partnerFeeLiabilityRaw;
            accounting.partnerFeeLiabilityRaw = 0;
        } else if (allocation == 2) {
            recipient = _config.protocolFeeRecipient;
            amount = accounting.protocolFeeLiabilityRaw;
            accounting.protocolFeeLiabilityRaw = 0;
        } else {
            revert InvalidRecipient();
        }
        if (amount == 0) revert InvalidInventory();
        quoteToken.pushExact(recipient, amount);
        emit FeeClaimed(launchId, recipient, allocation, amount);
    }

    function setPaused(bool paused) external {
        if (msg.sender != factory) revert Unauthorized();
        if (lifecycle != DbcTypes.Lifecycle.ACTIVE && lifecycle != DbcTypes.Lifecycle.PAUSED) {
            revert InvalidLifecycle();
        }
        DbcTypes.Lifecycle previous = lifecycle;
        lifecycle = paused ? DbcTypes.Lifecycle.PAUSED : DbcTypes.Lifecycle.ACTIVE;
        emit LifecycleUpdated(launchId, previous, lifecycle);
    }

    function setGraduationManager(address manager) external {
        if (msg.sender != factory || manager == address(0) || graduationManager != address(0)) {
            revert Unauthorized();
        }
        graduationManager = manager;
    }

    function releaseMigrationAssets(address recipient, uint256 baseAmount, uint256 quoteAmount)
        external
        nonReentrant
    {
        if (msg.sender != graduationManager || recipient == address(0)) revert Unauthorized();
        if (lifecycle != DbcTypes.Lifecycle.GRADUATION_READY) revert InvalidLifecycle();
        if (quoteAmount != accounting.realQuoteReserveRaw) revert InvalidInventory();
        uint256 availableBase = IERC20Minimal(baseToken).balanceOf(address(this));
        if (baseAmount != availableBase) revert InvalidInventory();
        accounting.realQuoteReserveRaw = 0;
        baseToken.pushExact(recipient, baseAmount);
        quoteToken.pushExact(recipient, quoteAmount);
    }

    function completeGraduation(
        bytes32 migrationId,
        address destinationPool,
        uint256 destinationShares
    ) external {
        if (msg.sender != graduationManager) revert Unauthorized();
        if (
            lifecycle != DbcTypes.Lifecycle.GRADUATION_READY || migrationId == bytes32(0)
                || destinationPool == address(0) || destinationShares == 0
        ) revert InvalidLifecycle();
        graduation = DbcTypes.GraduationState({
            migrationId: migrationId,
            destinationPool: destinationPool,
            destinationShares: destinationShares,
            creatorSharesClaimed: 0,
            protocolSharesClaimed: 0,
            graduatedAt: uint64(block.timestamp)
        });
        lifecycle = DbcTypes.Lifecycle.GRADUATED;
        emit LifecycleUpdated(
            launchId, DbcTypes.Lifecycle.GRADUATION_READY, DbcTypes.Lifecycle.GRADUATED
        );
    }

    function config() external view returns (DbcTypes.TemplateConfig memory) {
        return _config;
    }

    function graduationState() external view returns (DbcTypes.GraduationState memory) {
        return graduation;
    }

    function graduationProgressBps() external view returns (uint256) {
        return FullMath.mulDiv(
            accounting.realQuoteReserveRaw, DbcTypes.BPS, _config.graduationThresholdRaw
        );
    }

    function _settleBuy(BuyQuote memory quote, address recipient) private {
        BondingCurveMath.FeeSplit memory split =
            BondingCurveMath.splitFee(quote.feeRaw, _config.fees);
        _accrueFee(split);
        accounting.realQuoteReserveRaw =
            _toUint128(uint256(accounting.realQuoteReserveRaw) + quote.netQuoteRaw);
        accounting.baseSoldRaw = _toUint128(uint256(accounting.baseSoldRaw) + quote.baseOutRaw);
        quoteToken.pullExact(msg.sender, quote.grossQuoteConsumedRaw);
        baseToken.pushExact(recipient, quote.baseOutRaw);
        emit CurveSwapExecuted(
            launchId,
            msg.sender,
            recipient,
            true,
            quote.grossQuoteConsumedRaw,
            quote.baseOutRaw,
            quote.feeRaw,
            quote.finalPriceX18,
            accounting.realQuoteReserveRaw,
            accounting.baseSoldRaw
        );
        emit FeeAccrued(launchId, split.creator, split.partner, split.protocol);
        if (accounting.realQuoteReserveRaw == _config.graduationThresholdRaw) {
            lifecycle = DbcTypes.Lifecycle.GRADUATION_READY;
            emit LifecycleUpdated(
                launchId, DbcTypes.Lifecycle.ACTIVE, DbcTypes.Lifecycle.GRADUATION_READY
            );
            emit GraduationReady(
                launchId, accounting.realQuoteReserveRaw, _config.graduationThresholdRaw
            );
        }
    }

    function _settleSell(SellQuote memory quote, address recipient) private {
        BondingCurveMath.FeeSplit memory split =
            BondingCurveMath.splitFee(quote.feeRaw, _config.fees);
        _accrueFee(split);
        accounting.realQuoteReserveRaw =
            _toUint128(uint256(accounting.realQuoteReserveRaw) - quote.grossQuoteOutRaw);
        accounting.baseSoldRaw = _toUint128(uint256(accounting.baseSoldRaw) - quote.baseInRaw);
        baseToken.pullExact(msg.sender, quote.baseInRaw);
        quoteToken.pushExact(recipient, quote.netQuoteOutRaw);
        emit CurveSwapExecuted(
            launchId,
            msg.sender,
            recipient,
            false,
            quote.baseInRaw,
            quote.netQuoteOutRaw,
            quote.feeRaw,
            quote.finalPriceX18,
            accounting.realQuoteReserveRaw,
            accounting.baseSoldRaw
        );
        emit FeeAccrued(launchId, split.creator, split.partner, split.protocol);
    }

    function _accrueFee(BondingCurveMath.FeeSplit memory split) private {
        accounting.creatorFeeLiabilityRaw =
            _toUint128(uint256(accounting.creatorFeeLiabilityRaw) + split.creator);
        if (_config.partnerFeeRecipient == address(0)) {
            split.protocol += split.partner;
            split.partner = 0;
        }
        accounting.partnerFeeLiabilityRaw =
            _toUint128(uint256(accounting.partnerFeeLiabilityRaw) + split.partner);
        accounting.protocolFeeLiabilityRaw =
            _toUint128(uint256(accounting.protocolFeeLiabilityRaw) + split.protocol);
    }

    function _grossForNetCap(uint256 maximumGross, uint256 netCap)
        private
        view
        returns (uint256 gross)
    {
        uint256 denominator = DbcTypes.BPS - _config.fees.tradeFeeBps;
        gross = FullMath.mulDivRoundingUp(netCap, DbcTypes.BPS, denominator);
        if (gross > maximumGross) gross = maximumGross;
        uint256 net = gross - BondingCurveMath.feeOnGross(gross, _config.fees.tradeFeeBps);
        if (net > netCap) {
            --gross;
        } else if (gross < maximumGross) {
            uint256 candidate = gross + 1;
            uint256 candidateNet =
                candidate - BondingCurveMath.feeOnGross(candidate, _config.fees.tradeFeeBps);
            if (candidateNet <= netCap) gross = candidate;
        }
    }

    function _grossForExactNet(uint256 netAmount) private view returns (uint256 gross) {
        uint256 denominator = DbcTypes.BPS - _config.fees.tradeFeeBps;
        gross = FullMath.mulDivRoundingUp(netAmount, DbcTypes.BPS, denominator);
        uint256 resultingNet = gross - BondingCurveMath.feeOnGross(gross, _config.fees.tradeFeeBps);
        if (resultingNet > netAmount) {
            --gross;
        } else if (resultingNet < netAmount) {
            ++gross;
        }
        resultingNet = gross - BondingCurveMath.feeOnGross(gross, _config.fees.tradeFeeBps);
        if (resultingNet != netAmount) revert InvalidInventory();
    }

    function _validateExecution(address recipient, uint256 deadline) private view {
        if (recipient == address(0)) revert InvalidRecipient();
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (lifecycle != DbcTypes.Lifecycle.ACTIVE) revert InvalidLifecycle();
    }

    function _toUint128(uint256 value) private pure returns (uint128) {
        if (value > type(uint128).max) revert InvalidInventory();
        return uint128(value);
    }
}

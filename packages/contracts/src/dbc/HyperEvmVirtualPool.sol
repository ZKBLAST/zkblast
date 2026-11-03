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

/// @notice Clone-compatible, exact-input DBC pool for HyperEVM's bounded block gas.
contract HyperEvmVirtualPool is IDbcEvents, ReentrancyGuard {
    using DbcConfigStorage for DbcTypes.TemplateConfig;
    using TokenTransfer for address;

    error InvalidConfiguration();
    error InvalidLifecycle();
    error InvalidInventory();
    error InvalidRecipient();
    error SlippageExceeded();
    error DeadlineExpired();
    error InsufficientReserve();
    error Unauthorized();

    struct BuyQuote { uint256 grossQuoteConsumedRaw; uint256 netQuoteRaw; uint256 baseOutRaw; uint256 feeRaw; uint256 finalPriceX18; }
    struct SellQuote { uint256 baseInRaw; uint256 grossQuoteOutRaw; uint256 netQuoteOutRaw; uint256 feeRaw; uint256 finalPriceX18; }

    bool private _initialized;
    bytes32 public launchId;
    uint256 public templateId;
    address public factory;
    address public creator;
    address public baseToken;
    address public quoteToken;
    address public feeCollector;
    address public graduationManager;
    DbcTypes.Lifecycle public lifecycle;
    DbcTypes.PoolAccounting public accounting;
    DbcTypes.GraduationState public graduation;
    DbcTypes.TemplateConfig private _config;

    function initialize(bytes32 launchId_, uint256 templateId_, address factory_, address creator_, address baseToken_, DbcTypes.TemplateConfig calldata config_, address feeCollector_) external {
        if (_initialized || launchId_ == bytes32(0) || factory_ == address(0) || creator_ == address(0) || baseToken_ == address(0) || config_.quoteToken == address(0)) revert InvalidConfiguration();
        _initialized = true; launchId = launchId_; templateId = templateId_; factory = factory_; creator = creator_; baseToken = baseToken_; quoteToken = config_.quoteToken; feeCollector = feeCollector_;
        DbcTypes.TemplateConfig memory copied = config_;
        _config.write(copied);
        lifecycle = DbcTypes.Lifecycle.DRAFT;
    }

    function activate() external {
        if (msg.sender != factory || lifecycle != DbcTypes.Lifecycle.DRAFT) revert Unauthorized();
        if (IERC20Minimal(baseToken).balanceOf(address(this)) != _config.baseInventoryRaw) revert InvalidInventory();
        lifecycle = DbcTypes.Lifecycle.ACTIVE;
        emit LifecycleUpdated(launchId, DbcTypes.Lifecycle.DRAFT, DbcTypes.Lifecycle.ACTIVE);
    }

    function quoteBuyExactInput(uint256 grossQuoteInRaw) public view returns (BuyQuote memory quote) {
        if (grossQuoteInRaw == 0 || lifecycle != DbcTypes.Lifecycle.ACTIVE) revert InvalidLifecycle();
        uint256 remaining = uint256(_config.graduationThresholdRaw) - accounting.realQuoteReserveRaw;
        uint256 fee = BondingCurveMath.feeOnGross(grossQuoteInRaw, _config.fees.tradeFeeBps);
        uint256 net = grossQuoteInRaw - fee;
        uint256 consumed = grossQuoteInRaw;
        if (net > remaining) { consumed = _grossForNetCap(grossQuoteInRaw, remaining); fee = BondingCurveMath.feeOnGross(consumed, _config.fees.tradeFeeBps); net = consumed - fee; }
        uint256 soldX18 = BondingCurveMath.normalizeToX18(accounting.baseSoldRaw, _config.baseDecimals);
        uint256 outX18 = SegmentedBondingCurveMath.baseOutForNetQuote(_config.curve, soldX18, BondingCurveMath.normalizeToX18(net, _config.quoteDecimals));
        quote = BuyQuote(consumed, net, BondingCurveMath.denormalizeDown(outX18, _config.baseDecimals), fee, SegmentedBondingCurveMath.marginalPrice(_config.curve, soldX18 + outX18));
    }

    function buyExactInput(uint256 grossQuoteInRaw, uint256 minimumBaseOutRaw, uint256 maximumPriceX18, address recipient, uint256 deadline) external nonReentrant returns (BuyQuote memory quote) {
        _validate(recipient, deadline); quote = quoteBuyExactInput(grossQuoteInRaw);
        if (quote.baseOutRaw == 0 || quote.baseOutRaw < minimumBaseOutRaw || (maximumPriceX18 != 0 && quote.finalPriceX18 > maximumPriceX18)) revert SlippageExceeded();
        BondingCurveMath.FeeSplit memory split = BondingCurveMath.splitFee(quote.feeRaw, _config.fees); _accrue(split);
        accounting.realQuoteReserveRaw = _u128(uint256(accounting.realQuoteReserveRaw) + quote.netQuoteRaw); accounting.baseSoldRaw = _u128(uint256(accounting.baseSoldRaw) + quote.baseOutRaw);
        quoteToken.pullExact(msg.sender, quote.grossQuoteConsumedRaw); baseToken.pushExact(recipient, quote.baseOutRaw);
        emit CurveSwapExecuted(launchId, msg.sender, recipient, true, quote.grossQuoteConsumedRaw, quote.baseOutRaw, quote.feeRaw, quote.finalPriceX18, accounting.realQuoteReserveRaw, accounting.baseSoldRaw);
        emit FeeAccrued(launchId, split.creator, split.partner, split.protocol);
        if (accounting.realQuoteReserveRaw == _config.graduationThresholdRaw) { lifecycle = DbcTypes.Lifecycle.GRADUATION_READY; emit LifecycleUpdated(launchId, DbcTypes.Lifecycle.ACTIVE, DbcTypes.Lifecycle.GRADUATION_READY); emit GraduationReady(launchId, accounting.realQuoteReserveRaw, _config.graduationThresholdRaw); }
    }

    function quoteSellExactInput(uint256 baseInRaw) public view returns (SellQuote memory quote) {
        if (baseInRaw == 0 || lifecycle != DbcTypes.Lifecycle.ACTIVE || baseInRaw > accounting.baseSoldRaw) revert InvalidLifecycle();
        uint256 soldX18 = BondingCurveMath.normalizeToX18(accounting.baseSoldRaw, _config.baseDecimals); uint256 inX18 = BondingCurveMath.normalizeToX18(baseInRaw, _config.baseDecimals);
        uint256 gross = BondingCurveMath.denormalizeDown(SegmentedBondingCurveMath.quoteSellExactBase(_config.curve, soldX18, inX18), _config.quoteDecimals); uint256 fee = BondingCurveMath.feeOnGross(gross, _config.fees.tradeFeeBps);
        quote = SellQuote(baseInRaw, gross, gross - fee, fee, SegmentedBondingCurveMath.marginalPrice(_config.curve, soldX18 - inX18));
    }

    function sellExactInput(uint256 baseInRaw, uint256 minimumQuoteOutRaw, uint256 minimumPriceX18, address recipient, uint256 deadline) external nonReentrant returns (SellQuote memory quote) {
        _validate(recipient, deadline); quote = quoteSellExactInput(baseInRaw);
        if (quote.netQuoteOutRaw == 0 || quote.netQuoteOutRaw < minimumQuoteOutRaw || (minimumPriceX18 != 0 && quote.finalPriceX18 < minimumPriceX18)) revert SlippageExceeded();
        if (quote.grossQuoteOutRaw > accounting.realQuoteReserveRaw) revert InsufficientReserve();
        BondingCurveMath.FeeSplit memory split = BondingCurveMath.splitFee(quote.feeRaw, _config.fees); _accrue(split);
        accounting.realQuoteReserveRaw = _u128(uint256(accounting.realQuoteReserveRaw) - quote.grossQuoteOutRaw); accounting.baseSoldRaw = _u128(uint256(accounting.baseSoldRaw) - quote.baseInRaw);
        baseToken.pullExact(msg.sender, quote.baseInRaw); quoteToken.pushExact(recipient, quote.netQuoteOutRaw);
        emit CurveSwapExecuted(launchId, msg.sender, recipient, false, quote.baseInRaw, quote.netQuoteOutRaw, quote.feeRaw, quote.finalPriceX18, accounting.realQuoteReserveRaw, accounting.baseSoldRaw); emit FeeAccrued(launchId, split.creator, split.partner, split.protocol);
    }

    function claimFees(uint8 allocation) external nonReentrant returns (uint256 amount) {
        if (feeCollector != address(0) && msg.sender != feeCollector) revert Unauthorized(); address recipient;
        if (allocation == 0) { recipient = creator; amount = accounting.creatorFeeLiabilityRaw; accounting.creatorFeeLiabilityRaw = 0; }
        else if (allocation == 1 && _config.partnerFeeRecipient != address(0)) { recipient = _config.partnerFeeRecipient; amount = accounting.partnerFeeLiabilityRaw; accounting.partnerFeeLiabilityRaw = 0; }
        else if (allocation == 2) { recipient = _config.protocolFeeRecipient; amount = accounting.protocolFeeLiabilityRaw; accounting.protocolFeeLiabilityRaw = 0; } else revert InvalidRecipient();
        if (amount == 0) revert InvalidInventory(); if (feeCollector != address(0)) recipient = feeCollector; quoteToken.pushExact(recipient, amount); emit FeeClaimed(launchId, recipient, allocation, amount);
    }

    function setPaused(bool paused) external { if (msg.sender != factory || (lifecycle != DbcTypes.Lifecycle.ACTIVE && lifecycle != DbcTypes.Lifecycle.PAUSED)) revert Unauthorized(); DbcTypes.Lifecycle previous = lifecycle; lifecycle = paused ? DbcTypes.Lifecycle.PAUSED : DbcTypes.Lifecycle.ACTIVE; emit LifecycleUpdated(launchId, previous, lifecycle); }
    function setGraduationManager(address manager) external { if (msg.sender != factory || manager == address(0) || graduationManager != address(0)) revert Unauthorized(); graduationManager = manager; }
    function releaseMigrationAssets(address recipient, uint256 baseAmount, uint256 quoteAmount) external nonReentrant {
        if (msg.sender != graduationManager || recipient == address(0) || lifecycle != DbcTypes.Lifecycle.GRADUATION_READY) revert Unauthorized();
        if (quoteAmount != accounting.realQuoteReserveRaw || baseAmount != IERC20Minimal(baseToken).balanceOf(address(this))) revert InvalidInventory();
        accounting.realQuoteReserveRaw = 0; baseToken.pushExact(recipient, baseAmount); quoteToken.pushExact(recipient, quoteAmount);
    }
    function completeGraduation(bytes32 migrationId, address destinationPool, uint256 destinationShares) external {
        if (msg.sender != graduationManager || lifecycle != DbcTypes.Lifecycle.GRADUATION_READY || migrationId == bytes32(0) || destinationPool == address(0) || destinationShares == 0) revert Unauthorized();
        graduation = DbcTypes.GraduationState(migrationId, destinationPool, destinationShares, 0, 0, uint64(block.timestamp)); lifecycle = DbcTypes.Lifecycle.GRADUATED;
        emit LifecycleUpdated(launchId, DbcTypes.Lifecycle.GRADUATION_READY, DbcTypes.Lifecycle.GRADUATED);
    }
    function config() external view returns (DbcTypes.TemplateConfig memory) { return _config; }
    function graduationState() external view returns (DbcTypes.GraduationState memory) { return graduation; }
    function graduationProgressBps() external view returns (uint256) { return FullMath.mulDiv(accounting.realQuoteReserveRaw, DbcTypes.BPS, _config.graduationThresholdRaw); }

    function _accrue(BondingCurveMath.FeeSplit memory split) private { accounting.creatorFeeLiabilityRaw = _u128(uint256(accounting.creatorFeeLiabilityRaw) + split.creator); if (_config.partnerFeeRecipient == address(0)) { split.protocol += split.partner; split.partner = 0; } accounting.partnerFeeLiabilityRaw = _u128(uint256(accounting.partnerFeeLiabilityRaw) + split.partner); accounting.protocolFeeLiabilityRaw = _u128(uint256(accounting.protocolFeeLiabilityRaw) + split.protocol); }
    function _grossForNetCap(uint256 maximumGross, uint256 netCap) private view returns (uint256 gross) { gross = FullMath.mulDivRoundingUp(netCap, DbcTypes.BPS, DbcTypes.BPS - _config.fees.tradeFeeBps); if (gross > maximumGross) gross = maximumGross; if (gross - BondingCurveMath.feeOnGross(gross, _config.fees.tradeFeeBps) > netCap) --gross; }
    function _validate(address recipient, uint256 deadline) private view { if (recipient == address(0)) revert InvalidRecipient(); if (block.timestamp > deadline) revert DeadlineExpired(); if (lifecycle != DbcTypes.Lifecycle.ACTIVE) revert InvalidLifecycle(); }
    function _u128(uint256 value) private pure returns (uint128) { if (value > type(uint128).max) revert InvalidInventory(); return uint128(value); }
}

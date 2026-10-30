// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { PerpMath } from "./PerpMath.sol";
import { PerpTypes } from "./PerpTypes.sol";
import { PerpMarketRegistry } from "./PerpMarketRegistry.sol";
import { IPerpOracle } from "./interfaces/IPerpOracle.sol";
import { FundingRateModule } from "./FundingRateModule.sol";

/// @notice Canonical Perps position accounting. Asset custody is integrated through the
/// authorized settlement contract; this contract never receives arbitrary tokens or ETH.
contract PerpEngine is ProtocolAccess, UUPSUpgradeable {
    error InvalidEngineConfig();
    error InvalidPosition();
    error PositionAlreadyExists(bytes32 positionId);
    error PositionNotFound(bytes32 positionId);
    error MarketUnavailable(bytes32 marketId);
    error DeadlineExpired();
    error PriceLimitExceeded(uint256 executionPrice, uint256 acceptablePrice);
    error RiskLimitExceeded();
    error PositionNotLiquidatable();
    error SettlementMismatch();

    bytes32 public constant SETTLEMENT_ROLE = keccak256("ZKBLAST_PERP_SETTLEMENT_ROLE");
    bytes32 public constant RISK_ADMIN_ROLE = keccak256("ZKBLAST_PERP_RISK_ADMIN_ROLE");

    struct Position {
        bytes32 marketId;
        bytes32 ownerCommitment;
        uint128 marginUsd;
        uint128 notionalUsd;
        uint128 baseSize;
        uint128 entryPriceX18;
        int128 fundingIndexX18;
        uint64 openedAt;
        bool isLong;
    }

    struct OpenRequest {
        bytes32 positionId;
        bytes32 ownerCommitment;
        bytes32 marketId;
        uint128 marginUsd;
        uint32 leverageBps;
        uint128 acceptablePriceX18;
        uint64 deadline;
        bool isLong;
    }

    struct OpenResult {
        uint128 lockedMarginUsd;
        uint128 positionFeeUsd;
        uint128 notionalUsd;
        uint128 executionPriceX18;
    }

    struct CloseResult {
        uint128 payoutUsd;
        uint128 closeFeeUsd;
        int256 realizedPnlUsd;
        int256 fundingPaymentUsd;
        uint128 executionPriceX18;
    }

    struct ModifyRequest {
        bytes32 positionId;
        bytes32 newOwnerCommitment;
        uint128 expectedLockedMarginUsd;
        uint128 externalFeeUsd;
        uint32 newLeverageBps;
        uint128 acceptableClosePriceX18;
        uint128 acceptableOpenPriceX18;
        uint64 deadline;
    }

    struct ModifyResult {
        uint128 lockedMarginUsd;
        uint128 totalProtocolFeeUsd;
        uint128 externalFeeUsd;
        uint128 notionalUsd;
        uint128 closePriceX18;
        uint128 openPriceX18;
        int256 realizedPnlUsd;
        int256 fundingPaymentUsd;
    }

    struct LiquidationResult {
        uint128 residualPayoutUsd;
        uint128 keeperRewardUsd;
        uint128 closeFeeUsd;
        uint128 badDebtUsd;
        int256 realizedPnlUsd;
        int256 fundingPaymentUsd;
        uint128 executionPriceX18;
    }

    struct MarketRisk {
        uint128 longOpenInterestUsd;
        uint128 shortOpenInterestUsd;
    }

    struct CloseQuote {
        uint256 executionPriceX18;
        uint256 closeFeeUsd;
        uint256 payoutUsd;
        int256 realizedPnlUsd;
        int256 fundingPaymentUsd;
        uint256 currentNotionalUsd;
    }

    struct OpenQuote {
        uint256 nextLongOpenInterestUsd;
        uint256 nextShortOpenInterestUsd;
        uint256 lockedMarginUsd;
        uint256 positionFeeUsd;
        uint256 notionalUsd;
        uint256 baseSize;
        uint256 executionPriceX18;
    }

    struct ModifyQuote {
        uint256 expectedLockedMarginUsd;
        uint256 notionalUsd;
        uint256 closePriceX18;
        uint256 openPriceX18;
        uint256 totalProtocolFeeUsd;
        int256 realizedPnlUsd;
        int256 fundingPaymentUsd;
    }

    PerpMarketRegistry public registry;
    IPerpOracle public oracle;
    FundingRateModule public funding;
    bool public openingsPaused;
    uint256 public totalBadDebtUsd;

    mapping(bytes32 positionId => Position position) private _positions;
    mapping(bytes32 marketId => MarketRisk risk) private _marketRisk;

    event OpeningPauseUpdated(bool paused);
    event PositionOpened(
        bytes32 indexed positionId,
        bytes32 indexed marketId,
        bytes32 indexed ownerCommitment,
        bool isLong,
        uint256 marginUsd,
        uint256 notionalUsd,
        uint256 baseSize,
        uint256 executionPriceX18,
        uint256 positionFeeUsd
    );
    event PositionClosed(
        bytes32 indexed positionId,
        bytes32 indexed marketId,
        bytes32 indexed payoutCommitment,
        uint256 executionPriceX18,
        int256 realizedPnlUsd,
        uint256 payoutUsd,
        uint256 closeFeeUsd
    );
    event PositionModified(
        bytes32 indexed positionId,
        bytes32 indexed marketId,
        bytes32 indexed newOwnerCommitment,
        uint256 lockedMarginUsd,
        uint256 notionalUsd,
        uint256 closePriceX18,
        uint256 openPriceX18,
        int256 realizedPnlUsd,
        int256 fundingPaymentUsd,
        uint256 protocolFeeUsd,
        uint256 externalFeeUsd
    );
    event PositionLiquidated(
        bytes32 indexed positionId,
        bytes32 indexed marketId,
        bytes32 indexed residualCommitment,
        address keeper,
        uint256 executionPriceX18,
        int256 realizedPnlUsd,
        int256 fundingPaymentUsd,
        uint256 residualPayoutUsd,
        uint256 keeperRewardUsd,
        uint256 badDebtUsd
    );

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        address upgrader,
        address riskAdmin,
        address settlement,
        address registry_,
        address oracle_,
        address funding_
    ) external initializer {
        if (
            riskAdmin == address(0) || settlement == address(0) || registry_.code.length == 0
                || oracle_.code.length == 0 || funding_.code.length == 0
        ) revert InvalidEngineConfig();
        __ProtocolAccess_init(admin, upgrader);
        _setRole(RISK_ADMIN_ROLE, riskAdmin, true);
        _setRole(SETTLEMENT_ROLE, settlement, true);
        registry = PerpMarketRegistry(registry_);
        oracle = IPerpOracle(oracle_);
        funding = FundingRateModule(funding_);
    }

    function setOpeningsPaused(bool paused) external onlyRole(RISK_ADMIN_ROLE) {
        openingsPaused = paused;
        emit OpeningPauseUpdated(paused);
    }

    function openPosition(OpenRequest calldata request)
        external
        onlyRole(SETTLEMENT_ROLE)
        returns (OpenResult memory result)
    {
        if (block.timestamp > request.deadline) revert DeadlineExpired();
        if (
            request.positionId == bytes32(0) || request.ownerCommitment == bytes32(0)
                || request.marginUsd == 0 || request.acceptablePriceX18 == 0
        ) revert InvalidPosition();
        if (_positions[request.positionId].openedAt != 0) {
            revert PositionAlreadyExists(request.positionId);
        }

        PerpTypes.MarketConfig memory config = registry.market(request.marketId);
        if (openingsPaused || !config.enabled || registry.isPaused(request.marketId)) {
            revert MarketUnavailable(request.marketId);
        }

        MarketRisk storage risk = _marketRisk[request.marketId];
        OpenQuote memory quote = _quoteOpen(request, config, risk);
        if (
            (request.isLong && quote.executionPriceX18 > request.acceptablePriceX18)
                || (!request.isLong && quote.executionPriceX18 < request.acceptablePriceX18)
        ) revert PriceLimitExceeded(quote.executionPriceX18, request.acceptablePriceX18);

        risk.longOpenInterestUsd = uint128(quote.nextLongOpenInterestUsd);
        risk.shortOpenInterestUsd = uint128(quote.nextShortOpenInterestUsd);
        _positions[request.positionId] = Position({
            marketId: request.marketId,
            ownerCommitment: request.ownerCommitment,
            marginUsd: uint128(quote.lockedMarginUsd),
            notionalUsd: uint128(quote.notionalUsd),
            baseSize: uint128(quote.baseSize),
            entryPriceX18: uint128(quote.executionPriceX18),
            fundingIndexX18: _safeFundingIndex(funding.currentIndex(request.marketId)),
            openedAt: uint64(block.timestamp),
            isLong: request.isLong
        });

        result = OpenResult(
            uint128(quote.lockedMarginUsd),
            uint128(quote.positionFeeUsd),
            uint128(quote.notionalUsd),
            uint128(quote.executionPriceX18)
        );
        emit PositionOpened(
            request.positionId,
            request.marketId,
            request.ownerCommitment,
            request.isLong,
            quote.lockedMarginUsd,
            quote.notionalUsd,
            quote.baseSize,
            quote.executionPriceX18,
            quote.positionFeeUsd
        );
    }

    function closePosition(
        bytes32 positionId,
        bytes32 payoutCommitment,
        uint128 acceptablePriceX18,
        uint64 deadline
    ) external onlyRole(SETTLEMENT_ROLE) returns (CloseResult memory result) {
        if (block.timestamp > deadline) revert DeadlineExpired();
        Position memory currentPosition = _positions[positionId];
        if (currentPosition.openedAt == 0) revert PositionNotFound(positionId);
        if (payoutCommitment == bytes32(0) || acceptablePriceX18 == 0) {
            revert InvalidPosition();
        }

        PerpTypes.MarketConfig memory config = registry.market(currentPosition.marketId);
        MarketRisk storage risk = _marketRisk[currentPosition.marketId];
        uint256 nextLong = risk.longOpenInterestUsd;
        uint256 nextShort = risk.shortOpenInterestUsd;
        if (currentPosition.isLong) nextLong -= currentPosition.notionalUsd;
        else nextShort -= currentPosition.notionalUsd;
        CloseQuote memory quote =
            _quoteClose(currentPosition, config, PerpMath.skew(nextLong, nextShort));
        if (
            (currentPosition.isLong && quote.executionPriceX18 < acceptablePriceX18)
                || (!currentPosition.isLong && quote.executionPriceX18 > acceptablePriceX18)
        ) revert PriceLimitExceeded(quote.executionPriceX18, acceptablePriceX18);
        if (quote.payoutUsd > type(uint128).max || quote.closeFeeUsd > type(uint128).max) {
            revert RiskLimitExceeded();
        }

        risk.longOpenInterestUsd = uint128(nextLong);
        risk.shortOpenInterestUsd = uint128(nextShort);
        delete _positions[positionId];

        result = CloseResult(
            uint128(quote.payoutUsd),
            uint128(quote.closeFeeUsd),
            quote.realizedPnlUsd,
            quote.fundingPaymentUsd,
            uint128(quote.executionPriceX18)
        );
        emit PositionClosed(
            positionId,
            currentPosition.marketId,
            payoutCommitment,
            quote.executionPriceX18,
            quote.realizedPnlUsd,
            quote.payoutUsd,
            quote.closeFeeUsd
        );
    }

    /// @notice Returns the canonical close settlement used by `closePosition` at the current block.
    function quoteClose(bytes32 positionId) external view returns (CloseQuote memory quote) {
        Position memory currentPosition = _positions[positionId];
        if (currentPosition.openedAt == 0) revert PositionNotFound(positionId);
        PerpTypes.MarketConfig memory config = registry.market(currentPosition.marketId);
        MarketRisk memory risk = _marketRisk[currentPosition.marketId];
        uint256 nextLong = risk.longOpenInterestUsd;
        uint256 nextShort = risk.shortOpenInterestUsd;
        if (currentPosition.isLong) nextLong -= currentPosition.notionalUsd;
        else nextShort -= currentPosition.notionalUsd;
        return _quoteClose(currentPosition, config, PerpMath.skew(nextLong, nextShort));
    }

    function quoteModify(bytes32 positionId, uint32 newLeverageBps, uint128 externalFeeUsd)
        external
        view
        returns (ModifyQuote memory quote)
    {
        Position memory currentPosition = _positions[positionId];
        if (currentPosition.openedAt == 0) revert PositionNotFound(positionId);
        PerpTypes.MarketConfig memory config = registry.market(currentPosition.marketId);
        MarketRisk memory risk = _marketRisk[currentPosition.marketId];
        (uint128 postCloseLong, uint128 postCloseShort) = _postCloseRisk(currentPosition, risk);
        CloseQuote memory closeQuote = _quoteClose(
            currentPosition, config, PerpMath.skew(postCloseLong, postCloseShort)
        );
        if (externalFeeUsd >= closeQuote.payoutUsd) revert RiskLimitExceeded();
        OpenQuote memory openQuote = _quoteReopen(
            closeQuote.payoutUsd - externalFeeUsd,
            newLeverageBps,
            currentPosition.isLong,
            config,
            postCloseLong,
            postCloseShort
        );
        quote = ModifyQuote({
            expectedLockedMarginUsd: openQuote.lockedMarginUsd,
            notionalUsd: openQuote.notionalUsd,
            closePriceX18: closeQuote.executionPriceX18,
            openPriceX18: openQuote.executionPriceX18,
            totalProtocolFeeUsd: closeQuote.closeFeeUsd + openQuote.positionFeeUsd,
            realizedPnlUsd: closeQuote.realizedPnlUsd,
            fundingPaymentUsd: closeQuote.fundingPaymentUsd
        });
    }

    /// @notice Atomically realizes the old position and reopens it with a new commitment and
    /// leverage. No PnL or funding is discarded between the two accounting legs.
    function modifyPosition(ModifyRequest calldata request)
        external
        onlyRole(SETTLEMENT_ROLE)
        returns (ModifyResult memory result)
    {
        if (block.timestamp > request.deadline) revert DeadlineExpired();
        if (
            request.newOwnerCommitment == bytes32(0) || request.expectedLockedMarginUsd == 0
                || request.acceptableClosePriceX18 == 0 || request.acceptableOpenPriceX18 == 0
        ) revert InvalidPosition();
        if (
            request.newOwnerCommitment == request.positionId
                || _positions[request.newOwnerCommitment].openedAt != 0
        ) revert PositionAlreadyExists(request.newOwnerCommitment);

        Position memory currentPosition = _positions[request.positionId];
        if (currentPosition.openedAt == 0) revert PositionNotFound(request.positionId);
        PerpTypes.MarketConfig memory config = registry.market(currentPosition.marketId);
        if (openingsPaused || !config.enabled || registry.isPaused(currentPosition.marketId)) {
            revert MarketUnavailable(currentPosition.marketId);
        }

        MarketRisk storage risk = _marketRisk[currentPosition.marketId];
        (uint128 postCloseLong, uint128 postCloseShort) = _postCloseRisk(currentPosition, risk);
        CloseQuote memory closeQuote = _quoteClose(
            currentPosition, config, PerpMath.skew(postCloseLong, postCloseShort)
        );
        if (
            (currentPosition.isLong
                    && closeQuote.executionPriceX18 < request.acceptableClosePriceX18)
                || (!currentPosition.isLong
                    && closeQuote.executionPriceX18 > request.acceptableClosePriceX18)
        ) revert PriceLimitExceeded(closeQuote.executionPriceX18, request.acceptableClosePriceX18);
        if (request.externalFeeUsd >= closeQuote.payoutUsd) revert RiskLimitExceeded();

        uint256 reopenMargin = closeQuote.payoutUsd - request.externalFeeUsd;
        OpenQuote memory openQuote = _quoteReopen(
            reopenMargin,
            request.newLeverageBps,
            currentPosition.isLong,
            config,
            postCloseLong,
            postCloseShort
        );
        if (
            (currentPosition.isLong
                    && openQuote.executionPriceX18 > request.acceptableOpenPriceX18)
                || (!currentPosition.isLong
                    && openQuote.executionPriceX18 < request.acceptableOpenPriceX18)
        ) revert PriceLimitExceeded(openQuote.executionPriceX18, request.acceptableOpenPriceX18);
        if (openQuote.lockedMarginUsd != request.expectedLockedMarginUsd) {
            revert SettlementMismatch();
        }

        risk.longOpenInterestUsd = uint128(openQuote.nextLongOpenInterestUsd);
        risk.shortOpenInterestUsd = uint128(openQuote.nextShortOpenInterestUsd);
        delete _positions[request.positionId];
        _positions[request.newOwnerCommitment] = Position({
            marketId: currentPosition.marketId,
            ownerCommitment: request.newOwnerCommitment,
            marginUsd: uint128(openQuote.lockedMarginUsd),
            notionalUsd: uint128(openQuote.notionalUsd),
            baseSize: uint128(openQuote.baseSize),
            entryPriceX18: uint128(openQuote.executionPriceX18),
            fundingIndexX18: _safeFundingIndex(funding.currentIndex(currentPosition.marketId)),
            openedAt: uint64(block.timestamp),
            isLong: currentPosition.isLong
        });

        uint256 totalProtocolFee = closeQuote.closeFeeUsd + openQuote.positionFeeUsd;
        if (totalProtocolFee > type(uint128).max) revert RiskLimitExceeded();
        result = ModifyResult({
            lockedMarginUsd: uint128(openQuote.lockedMarginUsd),
            totalProtocolFeeUsd: uint128(totalProtocolFee),
            externalFeeUsd: request.externalFeeUsd,
            notionalUsd: uint128(openQuote.notionalUsd),
            closePriceX18: uint128(closeQuote.executionPriceX18),
            openPriceX18: uint128(openQuote.executionPriceX18),
            realizedPnlUsd: closeQuote.realizedPnlUsd,
            fundingPaymentUsd: closeQuote.fundingPaymentUsd
        });
        _emitModification(request, currentPosition.marketId, result);
    }

    function liquidatePosition(bytes32 positionId, bytes32 residualCommitment, address keeper)
        external
        onlyRole(SETTLEMENT_ROLE)
        returns (LiquidationResult memory result)
    {
        Position memory currentPosition = _positions[positionId];
        if (currentPosition.openedAt == 0) revert PositionNotFound(positionId);
        if (residualCommitment == bytes32(0) || keeper == address(0)) revert InvalidPosition();

        PerpTypes.MarketConfig memory config = registry.market(currentPosition.marketId);
        MarketRisk storage risk = _marketRisk[currentPosition.marketId];
        (uint128 nextLong, uint128 nextShort) = _postCloseRisk(currentPosition, risk);
        result = _quoteLiquidation(currentPosition, config, PerpMath.skew(nextLong, nextShort));
        risk.longOpenInterestUsd = uint128(nextLong);
        risk.shortOpenInterestUsd = uint128(nextShort);
        totalBadDebtUsd += result.badDebtUsd;
        delete _positions[positionId];
        _emitLiquidation(positionId, currentPosition.marketId, residualCommitment, keeper, result);
    }

    function getPosition(bytes32 positionId) external view returns (Position memory) {
        return _positions[positionId];
    }

    function marketRisk(bytes32 marketId) external view returns (MarketRisk memory) {
        return _marketRisk[marketId];
    }

    function _absolute(int256 value) private pure returns (uint256) {
        return uint256(value < 0 ? -value : value);
    }

    function _quoteClose(
        Position memory currentPosition,
        PerpTypes.MarketConfig memory config,
        int256 postCloseSkew
    ) private view returns (CloseQuote memory quote) {
        IPerpOracle.Price memory indexPrice = oracle.latestPrice(config.oracleId);
        uint256 impact = PerpMath.priceImpactBps(
            postCloseSkew, config.maxOpenInterestUsd, config.maxPriceImpactBps
        );
        quote.executionPriceX18 =
            PerpMath.executionPrice(indexPrice.value, !currentPosition.isLong, impact);
        quote.realizedPnlUsd = PerpMath.pnl(
            currentPosition.isLong,
            currentPosition.baseSize,
            currentPosition.entryPriceX18,
            quote.executionPriceX18
        );
        uint256 closeNotional =
            PerpMath.notionalFromBase(currentPosition.baseSize, quote.executionPriceX18);
        quote.currentNotionalUsd = closeNotional;
        quote.closeFeeUsd = PerpMath.fee(closeNotional, config.positionFeeBps);
        quote.fundingPaymentUsd = PerpMath.fundingFromIndex(
            currentPosition.notionalUsd,
            funding.currentIndex(currentPosition.marketId) - currentPosition.fundingIndexX18,
            currentPosition.isLong
        );
        int256 finalEquity = int256(uint256(currentPosition.marginUsd)) + quote.realizedPnlUsd
            - quote.fundingPaymentUsd - int256(quote.closeFeeUsd);
        quote.payoutUsd = finalEquity > 0 ? uint256(finalEquity) : 0;
    }

    function _quoteOpen(
        OpenRequest calldata request,
        PerpTypes.MarketConfig memory config,
        MarketRisk storage risk
    ) private view returns (OpenQuote memory quote) {
        quote.notionalUsd = PerpMath.notional(request.marginUsd, request.leverageBps);
        if (
            request.leverageBps > config.maxLeverageBps || quote.notionalUsd < config.minPositionUsd
                || quote.notionalUsd > config.maxPositionUsd
        ) revert RiskLimitExceeded();

        quote.nextLongOpenInterestUsd = risk.longOpenInterestUsd;
        quote.nextShortOpenInterestUsd = risk.shortOpenInterestUsd;
        if (request.isLong) quote.nextLongOpenInterestUsd += quote.notionalUsd;
        else quote.nextShortOpenInterestUsd += quote.notionalUsd;
        int256 nextSkew =
            PerpMath.skew(quote.nextLongOpenInterestUsd, quote.nextShortOpenInterestUsd);
        if (
            quote.nextLongOpenInterestUsd + quote.nextShortOpenInterestUsd
                    > config.maxOpenInterestUsd || _absolute(nextSkew) > config.maxSkewUsd
        ) revert RiskLimitExceeded();

        IPerpOracle.Price memory indexPrice = oracle.latestPrice(config.oracleId);
        uint256 impact = PerpMath.priceImpactBps(
            nextSkew, config.maxOpenInterestUsd, config.maxPriceImpactBps
        );
        quote.executionPriceX18 = PerpMath.executionPrice(indexPrice.value, request.isLong, impact);
        quote.positionFeeUsd = PerpMath.fee(quote.notionalUsd, config.positionFeeBps);
        if (quote.positionFeeUsd >= request.marginUsd) revert RiskLimitExceeded();
        quote.lockedMarginUsd = request.marginUsd - quote.positionFeeUsd;
        quote.baseSize = PerpMath.baseSize(quote.notionalUsd, quote.executionPriceX18);
        if (
            quote.notionalUsd > type(uint128).max || quote.lockedMarginUsd > type(uint128).max
                || quote.positionFeeUsd > type(uint128).max || quote.baseSize > type(uint128).max
                || quote.executionPriceX18 > type(uint128).max
        ) revert RiskLimitExceeded();
    }

    function _quoteReopen(
        uint256 marginUsd,
        uint32 leverageBps,
        bool isLong,
        PerpTypes.MarketConfig memory config,
        uint256 currentLongOpenInterestUsd,
        uint256 currentShortOpenInterestUsd
    ) private view returns (OpenQuote memory quote) {
        quote.notionalUsd = PerpMath.notional(marginUsd, leverageBps);
        if (
            leverageBps > config.maxLeverageBps || quote.notionalUsd < config.minPositionUsd
                || quote.notionalUsd > config.maxPositionUsd
        ) revert RiskLimitExceeded();
        quote.nextLongOpenInterestUsd = currentLongOpenInterestUsd;
        quote.nextShortOpenInterestUsd = currentShortOpenInterestUsd;
        if (isLong) quote.nextLongOpenInterestUsd += quote.notionalUsd;
        else quote.nextShortOpenInterestUsd += quote.notionalUsd;
        int256 nextSkew =
            PerpMath.skew(quote.nextLongOpenInterestUsd, quote.nextShortOpenInterestUsd);
        if (
            quote.nextLongOpenInterestUsd + quote.nextShortOpenInterestUsd
                    > config.maxOpenInterestUsd || _absolute(nextSkew) > config.maxSkewUsd
        ) revert RiskLimitExceeded();
        IPerpOracle.Price memory indexPrice = oracle.latestPrice(config.oracleId);
        uint256 impact = PerpMath.priceImpactBps(
            nextSkew, config.maxOpenInterestUsd, config.maxPriceImpactBps
        );
        quote.executionPriceX18 = PerpMath.executionPrice(indexPrice.value, isLong, impact);
        quote.positionFeeUsd = PerpMath.fee(quote.notionalUsd, config.positionFeeBps);
        if (quote.positionFeeUsd >= marginUsd) revert RiskLimitExceeded();
        quote.lockedMarginUsd = marginUsd - quote.positionFeeUsd;
        quote.baseSize = PerpMath.baseSize(quote.notionalUsd, quote.executionPriceX18);
        if (
            quote.notionalUsd > type(uint128).max || quote.lockedMarginUsd > type(uint128).max
                || quote.positionFeeUsd > type(uint128).max || quote.baseSize > type(uint128).max
                || quote.executionPriceX18 > type(uint128).max
        ) revert RiskLimitExceeded();
    }

    function _safeFundingIndex(int256 index) private pure returns (int128) {
        if (index < type(int128).min || index > type(int128).max) revert RiskLimitExceeded();
        return int128(index);
    }

    function _postCloseRisk(Position memory currentPosition, MarketRisk memory risk)
        private
        pure
        returns (uint128 nextLong, uint128 nextShort)
    {
        nextLong = risk.longOpenInterestUsd;
        nextShort = risk.shortOpenInterestUsd;
        if (currentPosition.isLong) nextLong -= currentPosition.notionalUsd;
        else nextShort -= currentPosition.notionalUsd;
    }

    function _quoteLiquidation(
        Position memory currentPosition,
        PerpTypes.MarketConfig memory config,
        int256 postCloseSkew
    ) private view returns (LiquidationResult memory result) {
        CloseQuote memory quote = _quoteClose(currentPosition, config, postCloseSkew);
        uint256 maintenance =
            PerpMath.maintenanceMargin(quote.currentNotionalUsd, config.maintenanceMarginBps);
        int256 equityBeforeFees = int256(uint256(currentPosition.marginUsd)) + quote.realizedPnlUsd
            - quote.fundingPaymentUsd;
        if (equityBeforeFees > int256(maintenance)) revert PositionNotLiquidatable();

        uint256 keeperReward = PerpMath.fee(quote.currentNotionalUsd, config.liquidationFeeBps);
        if (keeperReward > quote.payoutUsd) keeperReward = quote.payoutUsd;
        uint256 residualPayout = quote.payoutUsd - keeperReward;
        uint256 badDebt = equityBeforeFees < 0 ? uint256(-equityBeforeFees) : 0;
        if (
            keeperReward > type(uint128).max || residualPayout > type(uint128).max
                || quote.closeFeeUsd > type(uint128).max || badDebt > type(uint128).max
        ) revert RiskLimitExceeded();
        result = LiquidationResult({
            residualPayoutUsd: uint128(residualPayout),
            keeperRewardUsd: uint128(keeperReward),
            closeFeeUsd: uint128(quote.closeFeeUsd),
            badDebtUsd: uint128(badDebt),
            realizedPnlUsd: quote.realizedPnlUsd,
            fundingPaymentUsd: quote.fundingPaymentUsd,
            executionPriceX18: uint128(quote.executionPriceX18)
        });
    }

    function _emitLiquidation(
        bytes32 positionId,
        bytes32 marketId,
        bytes32 residualCommitment,
        address keeper,
        LiquidationResult memory result
    ) private {
        emit PositionLiquidated(
            positionId,
            marketId,
            residualCommitment,
            keeper,
            result.executionPriceX18,
            result.realizedPnlUsd,
            result.fundingPaymentUsd,
            result.residualPayoutUsd,
            result.keeperRewardUsd,
            result.badDebtUsd
        );
    }

    function _emitModification(
        ModifyRequest calldata request,
        bytes32 marketId,
        ModifyResult memory result
    ) private {
        emit PositionModified(
            request.positionId,
            marketId,
            request.newOwnerCommitment,
            result.lockedMarginUsd,
            result.notionalUsd,
            result.closePriceX18,
            result.openPriceX18,
            result.realizedPnlUsd,
            result.fundingPaymentUsd,
            result.totalProtocolFeeUsd,
            result.externalFeeUsd
        );
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

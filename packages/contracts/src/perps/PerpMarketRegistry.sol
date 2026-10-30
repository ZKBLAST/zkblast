// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { PerpTypes } from "./PerpTypes.sol";

contract PerpMarketRegistry is ProtocolAccess, UUPSUpgradeable {
    error InvalidMarket();
    error MarketAlreadyRegistered(bytes32 marketId);
    error MarketNotRegistered(bytes32 marketId);

    bytes32 public constant MARKET_ADMIN_ROLE = keccak256("ZKBLAST_PERP_MARKET_ADMIN_ROLE");

    mapping(bytes32 marketId => PerpTypes.MarketConfig config) private _markets;
    mapping(bytes32 marketId => bool registered) private _registered;
    mapping(bytes32 marketId => bool paused) private _paused;
    bytes32[] private _marketIds;

    event MarketRegistered(bytes32 indexed marketId, PerpTypes.MarketConfig config);
    event MarketConfigured(bytes32 indexed marketId, PerpTypes.MarketConfig config);
    event MarketStatusUpdated(bytes32 indexed marketId, bool enabled);
    event MarketPauseUpdated(bytes32 indexed marketId, bool paused);

    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address upgrader, address marketAdmin) external initializer {
        if (marketAdmin == address(0)) revert InvalidAccount();
        __ProtocolAccess_init(admin, upgrader);
        _setRole(MARKET_ADMIN_ROLE, marketAdmin, true);
    }

    function registerMarket(bytes32 marketId, PerpTypes.MarketConfig calldata config)
        external
        onlyRole(MARKET_ADMIN_ROLE)
    {
        if (_registered[marketId]) revert MarketAlreadyRegistered(marketId);
        _validate(marketId, config);
        _registered[marketId] = true;
        _markets[marketId] = config;
        _marketIds.push(marketId);
        emit MarketRegistered(marketId, config);
    }

    function configureMarket(bytes32 marketId, PerpTypes.MarketConfig calldata config)
        external
        onlyRole(MARKET_ADMIN_ROLE)
    {
        if (!_registered[marketId]) revert MarketNotRegistered(marketId);
        _validate(marketId, config);
        _markets[marketId] = config;
        emit MarketConfigured(marketId, config);
    }

    function setMarketEnabled(bytes32 marketId, bool enabled) external onlyRole(MARKET_ADMIN_ROLE) {
        if (!_registered[marketId]) revert MarketNotRegistered(marketId);
        _markets[marketId].enabled = enabled;
        emit MarketStatusUpdated(marketId, enabled);
    }

    function setMarketPaused(bytes32 marketId, bool paused) external onlyRole(MARKET_ADMIN_ROLE) {
        if (!_registered[marketId]) revert MarketNotRegistered(marketId);
        _paused[marketId] = paused;
        emit MarketPauseUpdated(marketId, paused);
    }

    function market(bytes32 marketId) external view returns (PerpTypes.MarketConfig memory config) {
        if (!_registered[marketId]) revert MarketNotRegistered(marketId);
        return _markets[marketId];
    }

    function marketIds() external view returns (bytes32[] memory) {
        return _marketIds;
    }

    function isRegistered(bytes32 marketId) external view returns (bool) {
        return _registered[marketId];
    }

    function isPaused(bytes32 marketId) external view returns (bool) {
        if (!_registered[marketId]) revert MarketNotRegistered(marketId);
        return _paused[marketId];
    }

    function _validate(bytes32 marketId, PerpTypes.MarketConfig calldata config) private pure {
        if (
            marketId == bytes32(0) || config.baseAsset == address(0)
                || config.oracleId == bytes32(0) || config.maxOpenInterestUsd == 0
                || config.maxSkewUsd == 0 || config.maxSkewUsd > config.maxOpenInterestUsd
                || config.maxPositionUsd == 0 || config.maxPositionUsd > config.maxOpenInterestUsd
                || config.minPositionUsd == 0 || config.minPositionUsd > config.maxPositionUsd
                || config.maxLeverageBps < PerpTypes.BPS
                || config.maxLeverageBps > PerpTypes.MAX_LEVERAGE_BPS
                || config.maintenanceMarginBps == 0 || config.maintenanceMarginBps >= PerpTypes.BPS
                || config.positionFeeBps >= PerpTypes.BPS
                || config.liquidationFeeBps >= PerpTypes.BPS
                || config.maxPriceImpactBps >= PerpTypes.BPS
        ) revert InvalidMarket();
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

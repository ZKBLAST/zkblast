// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { FullMath } from "../math/FullMath.sol";
import { IAggregatorV3 } from "./interfaces/IAggregatorV3.sol";
import { IPerpOracle } from "./interfaces/IPerpOracle.sol";

contract ChainlinkOracleAdapter is ProtocolAccess, UUPSUpgradeable, IPerpOracle {
    error InvalidOracleConfig();
    error OracleNotConfigured(bytes32 oracleId);
    error InvalidOraclePrice(bytes32 oracleId);
    error StaleOraclePrice(bytes32 oracleId, uint256 updatedAt, uint256 maximumAge);

    bytes32 public constant ORACLE_ADMIN_ROLE = keccak256("ZKBLAST_PERP_ORACLE_ADMIN_ROLE");

    struct FeedConfig {
        address feed;
        uint32 maximumAge;
        uint8 decimals;
        bool enabled;
    }

    mapping(bytes32 oracleId => FeedConfig config) private _feeds;

    event FeedConfigured(
        bytes32 indexed oracleId,
        address indexed feed,
        uint32 maximumAge,
        uint8 decimals,
        bool enabled
    );

    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address upgrader, address oracleAdmin) external initializer {
        if (oracleAdmin == address(0)) revert InvalidAccount();
        __ProtocolAccess_init(admin, upgrader);
        _setRole(ORACLE_ADMIN_ROLE, oracleAdmin, true);
    }

    function configureFeed(bytes32 oracleId, address feedAddress, uint32 maximumAge, bool enabled)
        external
        onlyRole(ORACLE_ADMIN_ROLE)
    {
        if (oracleId == bytes32(0) || feedAddress.code.length == 0 || maximumAge == 0) {
            revert InvalidOracleConfig();
        }
        uint8 feedDecimals = IAggregatorV3(feedAddress).decimals();
        if (feedDecimals > 18) revert InvalidOracleConfig();
        _feeds[oracleId] = FeedConfig(feedAddress, maximumAge, feedDecimals, enabled);
        emit FeedConfigured(oracleId, feedAddress, maximumAge, feedDecimals, enabled);
    }

    function latestPrice(bytes32 oracleId) external view returns (Price memory price) {
        FeedConfig memory config = _feeds[oracleId];
        if (config.feed == address(0) || !config.enabled) revert OracleNotConfigured(oracleId);

        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) =
            IAggregatorV3(config.feed).latestRoundData();
        if (
            answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp
                || answeredInRound < roundId
        ) revert InvalidOraclePrice(oracleId);
        if (block.timestamp - updatedAt > config.maximumAge) {
            revert StaleOraclePrice(oracleId, updatedAt, config.maximumAge);
        }

        uint256 scale = 10 ** config.decimals;
        price = Price({
            value: FullMath.mulDiv(uint256(answer), 1e18, scale), updatedAt: uint64(updatedAt)
        });
    }

    function feed(bytes32 oracleId) external view returns (FeedConfig memory) {
        return _feeds[oracleId];
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";

/// @notice Governed, bounded funding accumulator. Positive rates mean longs pay shorts.
contract FundingRateModule is ProtocolAccess, UUPSUpgradeable {
    error InvalidFundingConfig();
    error FundingRateOutOfBounds();

    bytes32 public constant FUNDING_ADMIN_ROLE = keccak256("ZKBLAST_PERP_FUNDING_ADMIN_ROLE");
    int256 private constant INDEX_SCALE = 1e18;
    int256 private constant BPS = 10_000;

    struct FundingState {
        int128 cumulativeIndexX18;
        int32 rateBpsPerHour;
        uint32 maximumAbsoluteRateBpsPerHour;
        uint64 updatedAt;
    }

    mapping(bytes32 marketId => FundingState state) private _funding;

    event FundingConfigured(bytes32 indexed marketId, uint32 maximumAbsoluteRateBpsPerHour);
    event FundingRateUpdated(
        bytes32 indexed marketId, int32 rateBpsPerHour, int256 cumulativeIndexX18
    );

    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address upgrader, address fundingAdmin)
        external
        initializer
    {
        if (fundingAdmin == address(0)) revert InvalidFundingConfig();
        __ProtocolAccess_init(admin, upgrader);
        _setRole(FUNDING_ADMIN_ROLE, fundingAdmin, true);
    }

    function configureMarket(bytes32 marketId, uint32 maximumAbsoluteRateBpsPerHour)
        external
        onlyRole(FUNDING_ADMIN_ROLE)
    {
        if (marketId == bytes32(0) || maximumAbsoluteRateBpsPerHour == 0) {
            revert InvalidFundingConfig();
        }
        FundingState storage state = _funding[marketId];
        _accrue(state);
        state.maximumAbsoluteRateBpsPerHour = maximumAbsoluteRateBpsPerHour;
        emit FundingConfigured(marketId, maximumAbsoluteRateBpsPerHour);
    }

    function setRate(bytes32 marketId, int32 rateBpsPerHour) external onlyRole(FUNDING_ADMIN_ROLE) {
        FundingState storage state = _funding[marketId];
        uint32 maximumRate = state.maximumAbsoluteRateBpsPerHour;
        if (maximumRate == 0 || _absolute(rateBpsPerHour) > maximumRate) {
            revert FundingRateOutOfBounds();
        }
        _accrue(state);
        state.rateBpsPerHour = rateBpsPerHour;
        emit FundingRateUpdated(marketId, rateBpsPerHour, state.cumulativeIndexX18);
    }

    function currentIndex(bytes32 marketId) public view returns (int256) {
        FundingState memory state = _funding[marketId];
        if (state.updatedAt == 0 || state.rateBpsPerHour == 0) {
            return state.cumulativeIndexX18;
        }
        return int256(state.cumulativeIndexX18)
            + _indexDelta(state.rateBpsPerHour, block.timestamp - state.updatedAt);
    }

    function fundingState(bytes32 marketId) external view returns (FundingState memory) {
        return _funding[marketId];
    }

    function _accrue(FundingState storage state) private {
        if (state.updatedAt == 0) {
            state.updatedAt = uint64(block.timestamp);
            return;
        }
        int256 nextIndex = int256(state.cumulativeIndexX18)
            + _indexDelta(state.rateBpsPerHour, block.timestamp - state.updatedAt);
        if (nextIndex < type(int128).min || nextIndex > type(int128).max) {
            revert FundingRateOutOfBounds();
        }
        state.cumulativeIndexX18 = int128(nextIndex);
        state.updatedAt = uint64(block.timestamp);
    }

    function _indexDelta(int32 rateBpsPerHour, uint256 elapsedSeconds)
        private
        pure
        returns (int256)
    {
        return int256(rateBpsPerHour) * int256(elapsedSeconds) * INDEX_SCALE / BPS / 1 hours;
    }

    function _absolute(int32 value) private pure returns (uint32) {
        return uint32(uint256(value < 0 ? -int256(value) : int256(value)));
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

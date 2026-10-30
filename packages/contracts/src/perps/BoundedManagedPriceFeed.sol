// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IAggregatorV3 } from "./interfaces/IAggregatorV3.sol";

/// @notice Minimal AggregatorV3-compatible alpha feed with bounded reporter updates.
/// @dev This is an explicitly managed fallback, not a decentralized oracle network.
contract BoundedManagedPriceFeed is IAggregatorV3 {
    error Unauthorized();
    error InvalidConfiguration();
    error InvalidObservation();
    error ExcessiveDeviation(uint256 deviationBps, uint256 maximumDeviationBps);

    uint256 private constant BPS = 10_000;

    uint8 public constant decimals = 8;
    string public description;
    address public immutable admin;
    address public reporter;
    uint16 public maximumDeviationBps;
    uint32 public maximumObservationDelay;

    uint80 private _roundId;
    int256 private _answer;
    uint256 private _startedAt;
    uint256 private _updatedAt;

    event ReporterUpdated(address indexed previousReporter, address indexed newReporter);
    event LimitsUpdated(uint16 maximumDeviationBps, uint32 maximumObservationDelay);
    event AnswerUpdated(int256 indexed answer, uint80 indexed roundId, uint256 observedAt);

    constructor(
        address admin_,
        address reporter_,
        string memory description_,
        int256 initialAnswer,
        uint256 observedAt,
        uint16 maximumDeviationBps_,
        uint32 maximumObservationDelay_
    ) {
        if (
            admin_ == address(0) || reporter_ == address(0) || bytes(description_).length == 0
                || initialAnswer <= 0 || maximumDeviationBps_ == 0
                || maximumDeviationBps_ >= BPS || maximumObservationDelay_ == 0
        ) revert InvalidConfiguration();
        admin = admin_;
        reporter = reporter_;
        description = description_;
        maximumDeviationBps = maximumDeviationBps_;
        maximumObservationDelay = maximumObservationDelay_;
        _record(initialAnswer, observedAt, false);
    }

    function submit(int256 answer, uint256 observedAt) external {
        if (msg.sender != reporter) revert Unauthorized();
        _record(answer, observedAt, true);
    }

    function setReporter(address nextReporter) external {
        if (msg.sender != admin) revert Unauthorized();
        if (nextReporter == address(0)) revert InvalidConfiguration();
        address previous = reporter;
        reporter = nextReporter;
        emit ReporterUpdated(previous, nextReporter);
    }

    function setLimits(uint16 maximumDeviationBps_, uint32 maximumObservationDelay_) external {
        if (msg.sender != admin) revert Unauthorized();
        if (
            maximumDeviationBps_ == 0 || maximumDeviationBps_ >= BPS
                || maximumObservationDelay_ == 0
        ) revert InvalidConfiguration();
        maximumDeviationBps = maximumDeviationBps_;
        maximumObservationDelay = maximumObservationDelay_;
        emit LimitsUpdated(maximumDeviationBps_, maximumObservationDelay_);
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (_roundId, _answer, _startedAt, _updatedAt, _roundId);
    }

    function _record(int256 answer, uint256 observedAt, bool enforceDeviation) private {
        if (
            answer <= 0 || observedAt == 0 || observedAt > block.timestamp
                || block.timestamp - observedAt > maximumObservationDelay
                || observedAt < _updatedAt
        ) revert InvalidObservation();
        if (enforceDeviation) {
            uint256 previous = uint256(_answer);
            uint256 next = uint256(answer);
            uint256 delta = next > previous ? next - previous : previous - next;
            uint256 deviationBps = delta * BPS / previous;
            if (deviationBps > maximumDeviationBps) {
                revert ExcessiveDeviation(deviationBps, maximumDeviationBps);
            }
        }
        _roundId += 1;
        _answer = answer;
        _startedAt = observedAt;
        _updatedAt = observedAt;
        emit AnswerUpdated(answer, _roundId, observedAt);
    }
}

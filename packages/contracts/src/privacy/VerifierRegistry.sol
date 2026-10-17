// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";

contract VerifierRegistry is ProtocolAccess, UUPSUpgradeable {
    error InvalidVerifier();
    error VerifierAlreadyRegistered();
    error VerifierNotRegistered();

    struct VerifierRecord {
        address verifier;
        bytes32 circuitHash;
        bytes32 verificationKeyHash;
        bool active;
    }

    mapping(bytes32 circuitId => mapping(uint64 version => VerifierRecord record)) private _records;

    event VerifierRegistered(
        bytes32 indexed circuitId,
        uint64 indexed version,
        address indexed verifier,
        bytes32 circuitHash,
        bytes32 verificationKeyHash
    );
    event VerifierStatusUpdated(bytes32 indexed circuitId, uint64 indexed version, bool active);

    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address upgrader) external initializer {
        __ProtocolAccess_init(admin, upgrader);
    }

    function register(
        bytes32 circuitId,
        uint64 version,
        address verifier,
        bytes32 circuitHash,
        bytes32 verificationKeyHash
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (
            circuitId == bytes32(0) || version == 0 || verifier.code.length == 0
                || circuitHash == bytes32(0) || verificationKeyHash == bytes32(0)
        ) revert InvalidVerifier();
        if (_records[circuitId][version].verifier != address(0)) {
            revert VerifierAlreadyRegistered();
        }

        _records[circuitId][version] = VerifierRecord({
            verifier: verifier,
            circuitHash: circuitHash,
            verificationKeyHash: verificationKeyHash,
            active: true
        });
        emit VerifierRegistered(circuitId, version, verifier, circuitHash, verificationKeyHash);
    }

    function setActive(bytes32 circuitId, uint64 version, bool active)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        VerifierRecord storage record = _records[circuitId][version];
        if (record.verifier == address(0)) revert VerifierNotRegistered();
        record.active = active;
        emit VerifierStatusUpdated(circuitId, version, active);
    }

    function get(bytes32 circuitId, uint64 version) external view returns (VerifierRecord memory) {
        return _records[circuitId][version];
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

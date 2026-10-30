// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { ReentrancyGuard } from "../security/ReentrancyGuard.sol";
import { TokenTransfer } from "../libraries/TokenTransfer.sol";
import { PerpEngine } from "./PerpEngine.sol";
import { LiquidityVaultUSDG } from "./LiquidityVaultUSDG.sol";
import { IPrivatePerpVerifier } from "./interfaces/IPrivatePerpVerifier.sol";
import { IPrivatePerpCustody } from "./interfaces/IPrivatePerpCustody.sol";

/// @notice Proof-authorized bridge between private USDG notes and public Perps state.
/// @dev Position size, side, market and execution remain public in v1. Note ownership stays private.
contract ShieldedPerpAdapter is ProtocolAccess, UUPSUpgradeable, ReentrancyGuard {
    using TokenTransfer for address;

    error InvalidConfiguration();
    error InvalidProofContext();
    error InvalidProof();
    error DeadlineExpired();
    error NullifierUnavailable();
    error SettlementMismatch();
    error ResidualUnavailable();

    uint256 private constant FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    address public collateral;
    LiquidityVaultUSDG public vault;
    IPrivatePerpCustody public custody;
    IPrivatePerpVerifier public openVerifier;
    IPrivatePerpVerifier public closeVerifier;
    IPrivatePerpVerifier public modifyVerifier;
    IPrivatePerpVerifier public claimVerifier;
    mapping(bytes32 nullifier => bool spent) public positionNullifierSpent;
    mapping(bytes32 positionId => uint256 residual) public liquidatedResidual;

    event PrivatePositionOpened(bytes32 indexed positionId, bytes32 indexed noteNullifier);
    event PrivatePositionClosed(bytes32 indexed positionId, bytes32 indexed positionNullifier);
    event PrivatePositionModified(
        bytes32 indexed positionId,
        bytes32 indexed oldPositionNullifier,
        bytes32 indexed newPositionCommitment,
        uint256 lockedMarginUsd,
        uint256 notionalUsd
    );
    event PrivatePositionLiquidated(bytes32 indexed positionId, uint256 residual, address keeper);
    event PrivateResidualClaimed(bytes32 indexed positionId, bytes32 indexed payoutCommitment);

    constructor() { _disableInitializers(); }

    function initialize(
        address admin,
        address upgrader,
        address collateral_,
        LiquidityVaultUSDG vault_,
        IPrivatePerpCustody custody_,
        IPrivatePerpVerifier openVerifier_,
        IPrivatePerpVerifier closeVerifier_,
        IPrivatePerpVerifier modifyVerifier_,
        IPrivatePerpVerifier claimVerifier_
    ) external initializer {
        if (
            collateral_.code.length == 0 || address(vault_).code.length == 0
                || address(custody_).code.length == 0 || address(openVerifier_).code.length == 0
                || address(closeVerifier_).code.length == 0
                || address(modifyVerifier_).code.length == 0
                || address(claimVerifier_).code.length == 0
        ) revert InvalidConfiguration();
        __ProtocolAccess_init(admin, upgrader);
        collateral = collateral_;
        vault = vault_;
        custody = custody_;
        openVerifier = openVerifier_;
        closeVerifier = closeVerifier_;
        modifyVerifier = modifyVerifier_;
        claimVerifier = claimVerifier_;
    }

    function openPrivatePosition(bytes calldata proof, uint256[21] calldata p)
        external
        nonReentrant
        returns (PerpEngine.OpenResult memory result)
    {
        uint256[] memory inputs = _copy(p);
        _context(inputs, 1, 6, 14);
        if (
            p[4] > type(uint160).max || p[5] > type(uint160).max || p[6] > type(uint64).max
                || p[10] > 1 || p[11] > type(uint128).max || p[12] > type(uint32).max
                || p[13] > type(uint128).max || p[14] > type(uint64).max
                || p[18] > type(uint128).max || p[19] > type(uint160).max
                || p[20] > type(uint128).max || p[4] != uint160(address(custody))
                || p[5] != uint160(collateral)
                || p[7] == 0 || !custody.isKnownRoot(bytes32(p[7]))
        ) {
            revert InvalidProofContext();
        }
        _verify(openVerifier, proof, inputs);
        uint256 total = p[11] + p[18] + p[20];
        custody.consumePerpsNote(collateral, uint64(p[6]), bytes32(p[7]), bytes32(p[15]), total, address(this));
        _pay(address(uint160(p[19])), p[20]);
        collateral.forceApprove(address(vault), p[11]);
        bytes32 positionId = bytes32(p[16]);
        result = vault.openPublicPosition(
            PerpEngine.OpenRequest({
                positionId: positionId,
                ownerCommitment: positionId,
                marketId: _market(p[8], p[9]),
                marginUsd: uint128(p[11]),
                leverageBps: uint32(p[12]),
                acceptablePriceX18: uint128(p[13]),
                deadline: uint64(p[14]),
                isLong: p[10] == 1
            })
        );
        collateral.forceApprove(address(custody), p[18]);
        custody.insertPerpsNote(collateral, p[18], bytes32(p[17]), address(this));
        emit PrivatePositionOpened(positionId, bytes32(p[15]));
    }

    function closePrivatePosition(bytes calldata proof, uint256[17] calldata p)
        external
        nonReentrant
        returns (PerpEngine.CloseResult memory result)
    {
        uint256[] memory inputs = _copy(p);
        _context(inputs, 2, 6, 13);
        if (p[4] != uint160(address(custody)) || p[5] != uint160(collateral)) revert InvalidProofContext();
        _consumePositionNullifier(bytes32(p[10]));
        _verify(closeVerifier, proof, inputs);
        bytes32 positionId = bytes32(p[9]);
        result = vault.closePublicPosition(positionId, bytes32(p[14]), uint128(p[12]), uint64(p[13]), address(this));
        if (result.payoutUsd != p[11] || p[16] >= p[11]) revert SettlementMismatch();
        _pay(address(uint160(p[15])), p[16]);
        uint256 privatePayout = p[11] - p[16];
        collateral.forceApprove(address(custody), privatePayout);
        custody.insertPerpsNote(collateral, privatePayout, bytes32(p[14]), address(this));
        emit PrivatePositionClosed(positionId, bytes32(p[10]));
    }

    function modifyPrivatePosition(bytes calldata proof, uint256[19] calldata p)
        external
        nonReentrant
        returns (PerpEngine.ModifyResult memory result)
    {
        uint256[] memory inputs = _copy(p);
        _context(inputs, 3, type(uint256).max, 16);
        if (
            p[6] > 1 || p[7] > type(uint128).max || p[8] > type(uint128).max
                || p[10] > type(uint32).max || p[14] > type(uint128).max
                || p[15] > type(uint128).max || p[16] > type(uint64).max
                || p[18] > type(uint128).max
        ) revert InvalidProofContext();
        bytes32 positionId = bytes32(p[11]);
        PerpEngine.Position memory position = vault.engine().getPosition(positionId);
        if (
            position.openedAt == 0 || position.ownerCommitment != positionId
                || position.marketId != _market(p[4], p[5]) || position.isLong != (p[6] == 1)
                || position.marginUsd != p[7]
        ) revert InvalidProofContext();
        _consumePositionNullifier(bytes32(p[12]));
        _verify(modifyVerifier, proof, inputs);
        result = vault.modifyPublicPosition(
            PerpEngine.ModifyRequest({
                positionId: positionId,
                newOwnerCommitment: bytes32(p[13]),
                expectedLockedMarginUsd: uint128(p[8]),
                externalFeeUsd: uint128(p[18]),
                newLeverageBps: uint32(p[10]),
                acceptableClosePriceX18: uint128(p[14]),
                acceptableOpenPriceX18: uint128(p[15]),
                deadline: uint64(p[16])
            }),
            address(uint160(p[17]))
        );
        if (result.lockedMarginUsd != p[8] || result.externalFeeUsd != p[18]) {
            revert SettlementMismatch();
        }
        emit PrivatePositionModified(
            positionId,
            bytes32(p[12]),
            bytes32(p[13]),
            result.lockedMarginUsd,
            result.notionalUsd
        );
    }

    function liquidatePrivatePosition(bytes32 positionId)
        external
        nonReentrant
        returns (PerpEngine.LiquidationResult memory result)
    {
        result = vault.liquidatePublicPosition(positionId, positionId);
        liquidatedResidual[positionId] = result.residualPayoutUsd;
        _pay(msg.sender, result.keeperRewardUsd);
        emit PrivatePositionLiquidated(positionId, result.residualPayoutUsd, msg.sender);
    }

    function claimLiquidatedResidual(bytes calldata proof, uint256[16] calldata p)
        external
        nonReentrant
    {
        uint256[] memory inputs = _copy(p);
        _context(inputs, 4, 6, 12);
        if (p[4] != uint160(address(custody)) || p[5] != uint160(collateral)) revert InvalidProofContext();
        _consumePositionNullifier(bytes32(p[10]));
        _verify(claimVerifier, proof, inputs);
        bytes32 positionId = bytes32(p[9]);
        uint256 residual = liquidatedResidual[positionId];
        if (residual == 0) revert ResidualUnavailable();
        if (residual != p[11] || p[15] >= residual) revert SettlementMismatch();
        delete liquidatedResidual[positionId];
        _pay(address(uint160(p[14])), p[15]);
        uint256 privatePayout = residual - p[15];
        collateral.forceApprove(address(custody), privatePayout);
        custody.insertPerpsNote(collateral, privatePayout, bytes32(p[13]), address(this));
        emit PrivateResidualClaimed(positionId, bytes32(p[13]));
    }

    function _context(uint256[] memory p, uint256 action, uint256 treeIndex, uint256 deadlineIndex)
        private
        view
    {
        for (uint256 i; i < p.length; ++i) if (p[i] >= FIELD) revert InvalidProofContext();
        if (
            p[0] != 1 || p[1] != action || p[2] != block.chainid
                || p[3] != uint160(address(this))
                || (treeIndex != type(uint256).max && p[treeIndex] != custody.treeVersion())
                || p[deadlineIndex] <= block.timestamp || p[deadlineIndex] > block.timestamp + 1 hours
        ) revert DeadlineExpired();
    }

    function _verify(IPrivatePerpVerifier verifier, bytes calldata proof, uint256[] memory p)
        private
        view
    {
        if (!verifier.verify(proof, p)) revert InvalidProof();
    }

    function _copy(uint256[21] calldata source) private pure returns (uint256[] memory values) {
        values = new uint256[](21);
        for (uint256 i; i < 21; ++i) values[i] = source[i];
    }

    function _copy(uint256[17] calldata source) private pure returns (uint256[] memory values) {
        values = new uint256[](17);
        for (uint256 i; i < 17; ++i) values[i] = source[i];
    }

    function _copy(uint256[19] calldata source) private pure returns (uint256[] memory values) {
        values = new uint256[](19);
        for (uint256 i; i < 19; ++i) values[i] = source[i];
    }

    function _copy(uint256[16] calldata source) private pure returns (uint256[] memory values) {
        values = new uint256[](16);
        for (uint256 i; i < 16; ++i) values[i] = source[i];
    }

    function _consumePositionNullifier(bytes32 nullifier) private {
        if (nullifier == bytes32(0) || positionNullifierSpent[nullifier]) revert NullifierUnavailable();
        positionNullifierSpent[nullifier] = true;
    }

    function _market(uint256 low, uint256 high) private pure returns (bytes32) {
        if (low > type(uint128).max || high > type(uint128).max) revert InvalidProofContext();
        return bytes32((high << 128) | low);
    }

    function _pay(address recipient, uint256 amount) private {
        if (amount != 0) collateral.pushExact(recipient, amount);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

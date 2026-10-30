// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { ReentrancyGuard } from "../security/ReentrancyGuard.sol";
import { IERC20Minimal } from "../interfaces/IERC20Minimal.sol";
import { TokenTransfer } from "../libraries/TokenTransfer.sol";
import { FullMath } from "../math/FullMath.sol";
import { PerpTypes } from "./PerpTypes.sol";
import { PerpEngine } from "./PerpEngine.sol";
import { InsuranceFund } from "./InsuranceFund.sol";

/// @notice Public USDG LP vault and the atomic custody boundary for public Perps positions.
/// LP shares are intentionally non-transferable in the capped alpha.
contract LiquidityVaultUSDG is ProtocolAccess, UUPSUpgradeable, ReentrancyGuard {
    using TokenTransfer for address;

    error InvalidVaultConfig();
    error VaultPaused();
    error DepositCeilingExceeded();
    error CooldownActive(uint256 availableAt);
    error InsufficientLiquidity();
    error UnauthorizedPosition();

    bytes32 public constant VAULT_ADMIN_ROLE = keccak256("ZKBLAST_PERP_VAULT_ADMIN_ROLE");
    uint256 private constant BPS = 10_000;

    address public asset;
    PerpEngine public engine;
    InsuranceFund public insuranceFund;
    uint128 public depositCeiling;
    uint64 public withdrawalCooldown;
    uint16 public insuranceFeeShareBps;
    bool public depositsPaused;
    bool public withdrawalsPaused;
    bool public positionsPaused;

    uint256 public totalShares;
    uint256 public traderMarginLiability;
    uint256 public reservedProfitLiquidity;
    mapping(address account => uint256 shares) public sharesOf;
    mapping(address account => uint64 timestamp) public lastDepositAt;
    mapping(bytes32 positionId => address owner) public positionOwner;
    mapping(bytes32 positionId => uint128 margin) public positionMargin;
    mapping(bytes32 positionId => uint128 reserve) public positionReserve;

    event VaultPauseUpdated(bool deposits, bool withdrawals, bool positions);
    event VaultLimitsUpdated(uint128 depositCeiling, uint64 withdrawalCooldown);
    event Deposited(
        address indexed sender, address indexed recipient, uint256 assets, uint256 shares
    );
    event Redeemed(
        address indexed owner, address indexed recipient, uint256 assets, uint256 shares
    );
    event PublicPositionOpened(
        bytes32 indexed positionId,
        address indexed owner,
        uint256 marginUsd,
        uint256 reserveUsd,
        uint256 insuranceFeeUsd
    );
    event PublicPositionClosed(
        bytes32 indexed positionId,
        address indexed owner,
        address indexed recipient,
        uint256 payoutUsd,
        uint256 insuranceFeeUsd
    );
    event PublicPositionModified(
        bytes32 indexed oldPositionId,
        bytes32 indexed newPositionId,
        address indexed owner,
        uint256 marginUsd,
        uint256 reserveUsd,
        uint256 insuranceFeeUsd,
        uint256 externalFeeUsd
    );
    event PublicPositionLiquidated(
        bytes32 indexed positionId,
        address indexed owner,
        address indexed keeper,
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
        address vaultAdmin,
        address asset_,
        address engine_,
        address insuranceFund_,
        uint128 depositCeiling_,
        uint64 withdrawalCooldown_,
        uint16 insuranceFeeShareBps_
    ) external initializer {
        if (
            vaultAdmin == address(0) || asset_.code.length == 0 || engine_.code.length == 0
                || insuranceFund_.code.length == 0 || depositCeiling_ == 0
                || insuranceFeeShareBps_ > BPS
        ) revert InvalidVaultConfig();
        __ProtocolAccess_init(admin, upgrader);
        _setRole(VAULT_ADMIN_ROLE, vaultAdmin, true);
        asset = asset_;
        engine = PerpEngine(engine_);
        insuranceFund = InsuranceFund(insuranceFund_);
        depositCeiling = depositCeiling_;
        withdrawalCooldown = withdrawalCooldown_;
        insuranceFeeShareBps = insuranceFeeShareBps_;
        depositsPaused = true;
        positionsPaused = true;
    }

    function setPaused(bool deposits, bool withdrawals, bool positions)
        external
        onlyRole(VAULT_ADMIN_ROLE)
    {
        depositsPaused = deposits;
        withdrawalsPaused = withdrawals;
        positionsPaused = positions;
        emit VaultPauseUpdated(deposits, withdrawals, positions);
    }

    function setLimits(uint128 depositCeiling_, uint64 withdrawalCooldown_)
        external
        onlyRole(VAULT_ADMIN_ROLE)
    {
        if (depositCeiling_ == 0 || depositCeiling_ < lpAssets()) {
            revert InvalidVaultConfig();
        }
        depositCeiling = depositCeiling_;
        withdrawalCooldown = withdrawalCooldown_;
        emit VaultLimitsUpdated(depositCeiling_, withdrawalCooldown_);
    }

    function deposit(uint256 assets, address recipient)
        external
        nonReentrant
        returns (uint256 shares)
    {
        if (depositsPaused) revert VaultPaused();
        if (assets == 0 || recipient == address(0)) revert InvalidVaultConfig();
        uint256 assetsBefore = lpAssets();
        if (assetsBefore + assets > depositCeiling) revert DepositCeilingExceeded();
        shares = totalShares == 0 ? assets : FullMath.mulDiv(assets, totalShares, assetsBefore);
        if (shares == 0) revert InvalidVaultConfig();
        asset.pullExact(msg.sender, assets);
        totalShares += shares;
        sharesOf[recipient] += shares;
        lastDepositAt[recipient] = uint64(block.timestamp);
        emit Deposited(msg.sender, recipient, assets, shares);
    }

    function redeem(uint256 shares, address recipient)
        external
        nonReentrant
        returns (uint256 assets)
    {
        if (withdrawalsPaused) revert VaultPaused();
        if (shares == 0 || recipient == address(0)) revert InvalidVaultConfig();
        uint256 availableAt = uint256(lastDepositAt[msg.sender]) + withdrawalCooldown;
        if (block.timestamp < availableAt) revert CooldownActive(availableAt);
        uint256 currentLpAssets = lpAssets();
        assets = FullMath.mulDiv(shares, currentLpAssets, totalShares);
        if (assets > availableLiquidity()) revert InsufficientLiquidity();
        sharesOf[msg.sender] -= shares;
        totalShares -= shares;
        asset.pushExact(recipient, assets);
        emit Redeemed(msg.sender, recipient, assets, shares);
    }

    function openPublicPosition(PerpEngine.OpenRequest calldata request)
        external
        nonReentrant
        returns (PerpEngine.OpenResult memory result)
    {
        if (positionsPaused) revert VaultPaused();
        if (positionOwner[request.positionId] != address(0)) revert UnauthorizedPosition();
        asset.pullExact(msg.sender, request.marginUsd);
        result = engine.openPosition(request);

        uint256 reserve = result.notionalUsd;
        positionOwner[request.positionId] = msg.sender;
        positionMargin[request.positionId] = result.lockedMarginUsd;
        positionReserve[request.positionId] = result.notionalUsd;
        traderMarginLiability += result.lockedMarginUsd;
        reservedProfitLiquidity += reserve;
        uint256 insuranceFee = _routeInsuranceFee(result.positionFeeUsd);
        if (lpAssets() < reservedProfitLiquidity) revert InsufficientLiquidity();
        emit PublicPositionOpened(
            request.positionId, msg.sender, result.lockedMarginUsd, reserve, insuranceFee
        );
    }

    function closePublicPosition(
        bytes32 positionId,
        bytes32 payoutCommitment,
        uint128 acceptablePriceX18,
        uint64 deadline,
        address recipient
    ) external nonReentrant returns (PerpEngine.CloseResult memory result) {
        address owner = positionOwner[positionId];
        if (owner == address(0) || msg.sender != owner || recipient == address(0)) {
            revert UnauthorizedPosition();
        }
        result = engine.closePosition(positionId, payoutCommitment, acceptablePriceX18, deadline);

        traderMarginLiability -= positionMargin[positionId];
        reservedProfitLiquidity -= positionReserve[positionId];
        delete positionOwner[positionId];
        delete positionMargin[positionId];
        delete positionReserve[positionId];

        _coverShortfall(result.payoutUsd);
        asset.pushExact(recipient, result.payoutUsd);
        uint256 insuranceFee = _routeInsuranceFee(result.closeFeeUsd);
        emit PublicPositionClosed(positionId, owner, recipient, result.payoutUsd, insuranceFee);
    }

    function modifyPublicPosition(PerpEngine.ModifyRequest calldata request, address feeRecipient)
        external
        nonReentrant
        returns (PerpEngine.ModifyResult memory result)
    {
        address owner = positionOwner[request.positionId];
        if (
            positionsPaused || owner == address(0) || msg.sender != owner
                || (request.externalFeeUsd != 0 && feeRecipient == address(0))
        ) revert UnauthorizedPosition();

        uint256 previousMargin = positionMargin[request.positionId];
        uint256 previousReserve = positionReserve[request.positionId];
        result = engine.modifyPosition(request);

        traderMarginLiability = traderMarginLiability - previousMargin + result.lockedMarginUsd;
        reservedProfitLiquidity = reservedProfitLiquidity - previousReserve + result.notionalUsd;
        delete positionOwner[request.positionId];
        delete positionMargin[request.positionId];
        delete positionReserve[request.positionId];
        positionOwner[request.newOwnerCommitment] = owner;
        positionMargin[request.newOwnerCommitment] = result.lockedMarginUsd;
        positionReserve[request.newOwnerCommitment] = result.notionalUsd;
        _coverShortfall(result.externalFeeUsd);
        if (result.externalFeeUsd != 0) asset.pushExact(feeRecipient, result.externalFeeUsd);
        uint256 insuranceFee = _routeInsuranceFee(result.totalProtocolFeeUsd);
        if (lpAssets() < reservedProfitLiquidity) revert InsufficientLiquidity();
        emit PublicPositionModified(
            request.positionId,
            request.newOwnerCommitment,
            owner,
            result.lockedMarginUsd,
            result.notionalUsd,
            insuranceFee,
            result.externalFeeUsd
        );
    }

    function liquidatePublicPosition(bytes32 positionId, bytes32 residualCommitment)
        external
        nonReentrant
        returns (PerpEngine.LiquidationResult memory result)
    {
        address owner = positionOwner[positionId];
        if (owner == address(0)) revert UnauthorizedPosition();
        result = engine.liquidatePosition(positionId, residualCommitment, msg.sender);

        traderMarginLiability -= positionMargin[positionId];
        reservedProfitLiquidity -= positionReserve[positionId];
        delete positionOwner[positionId];
        delete positionMargin[positionId];
        delete positionReserve[positionId];

        uint256 totalPayout = uint256(result.residualPayoutUsd) + result.keeperRewardUsd;
        _coverShortfall(totalPayout);
        if (result.keeperRewardUsd != 0) {
            asset.pushExact(msg.sender, result.keeperRewardUsd);
        }
        if (result.residualPayoutUsd != 0) {
            asset.pushExact(owner, result.residualPayoutUsd);
        }
        _routeInsuranceFee(result.closeFeeUsd);
        emit PublicPositionLiquidated(
            positionId,
            owner,
            msg.sender,
            result.residualPayoutUsd,
            result.keeperRewardUsd,
            result.badDebtUsd
        );
    }

    function totalAssets() public view returns (uint256) {
        return IERC20Minimal(asset).balanceOf(address(this));
    }

    function lpAssets() public view returns (uint256) {
        uint256 balance = totalAssets();
        return balance > traderMarginLiability ? balance - traderMarginLiability : 0;
    }

    function availableLiquidity() public view returns (uint256) {
        uint256 assets = lpAssets();
        return assets > reservedProfitLiquidity ? assets - reservedProfitLiquidity : 0;
    }

    function previewRedeem(uint256 shares) external view returns (uint256) {
        if (totalShares == 0) return 0;
        return FullMath.mulDiv(shares, lpAssets(), totalShares);
    }

    function _routeInsuranceFee(uint256 fee) private returns (uint256 insuranceFee) {
        insuranceFee = FullMath.mulDiv(fee, insuranceFeeShareBps, BPS);
        if (insuranceFee != 0) asset.pushExact(address(insuranceFund), insuranceFee);
    }

    function _coverShortfall(uint256 payout) private {
        uint256 balance = totalAssets();
        uint256 requiredBalance = payout + traderMarginLiability + reservedProfitLiquidity;
        if (balance < requiredBalance) {
            insuranceFund.cover(address(this), requiredBalance - balance);
        }
        if (totalAssets() < requiredBalance) revert InsufficientLiquidity();
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

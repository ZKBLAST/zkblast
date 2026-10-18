// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { IERC20Minimal } from "../interfaces/IERC20Minimal.sol";
import { IFieldHasher } from "../interfaces/IFieldHasher.sol";
import { TokenTransfer } from "../libraries/TokenTransfer.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { ReentrancyGuard } from "../security/ReentrancyGuard.sol";
import { IncrementalCommitmentTree } from "./IncrementalCommitmentTree.sol";
import { ShieldedStateRegistry } from "./ShieldedStateRegistry.sol";
import { ShieldedLPManager } from "./ShieldedLPManager.sol";
import { WithdrawalVerifierAdapter } from "./WithdrawalVerifierAdapter.sol";

contract ZKBlastVault is ProtocolAccess, UUPSUpgradeable, ReentrancyGuard {
    using IncrementalCommitmentTree for IncrementalCommitmentTree.Tree;
    using TokenTransfer for address;

    error InvalidConfiguration();
    error VaultPaused();
    error AssetNotAllowed();
    error InvalidDenomination();
    error AllowanceMustMatchAmount();
    error CommitmentAlreadyExists();
    error WithdrawalUnavailable();
    error InvalidWithdrawalContext();
    error LPManagerUnavailable();
    error InsolventAsset();

    struct AssetConfig {
        uint128 denomination;
        bool enabled;
    }

    struct WithdrawalContext {
        address asset;
        address recipient;
        uint256 amount;
        uint256 relayerFee;
    }

    uint64 public treeVersion;
    ShieldedStateRegistry public stateRegistry;
    IFieldHasher public fieldHasher;
    bool public paused;

    IncrementalCommitmentTree.Tree private _tree;
    mapping(address asset => AssetConfig config) public assetConfig;
    mapping(bytes32 commitment => bool inserted) public commitmentInserted;
    // Append-only proxy storage: new fields must remain below the original vault layout.
    WithdrawalVerifierAdapter public withdrawalAdapter;
    mapping(address asset => uint256 liability) public liabilityRaw;
    mapping(address asset => ShieldedLPManager manager) public lpManagerForAsset;

    event AssetConfigUpdated(address indexed asset, uint128 denomination, bool enabled);
    event PauseUpdated(bool paused);
    event CommitmentDeposited(
        address indexed depositor,
        address indexed asset,
        uint256 amount,
        bytes32 indexed commitment,
        uint32 leafIndex,
        bytes32 root,
        uint64 treeVersion
    );
    event WithdrawalAdapterUpdated(address indexed adapter);
    event LPManagerUpdated(address indexed asset, address indexed manager);
    event AggregateLiquidityInvested(
        address indexed manager, uint256 amount0, uint256 amount1, uint256 shares
    );
    event AggregateLiquidityDivested(
        address indexed manager, uint256 shares, uint256 amount0, uint256 amount1
    );
    event NoteWithdrawn(
        address indexed asset,
        address indexed recipient,
        bytes32 indexed nullifier,
        uint256 amount,
        address relayer,
        uint256 relayerFee,
        bytes32 root,
        uint64 treeVersion
    );

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        address upgrader,
        ShieldedStateRegistry stateRegistry_,
        IFieldHasher fieldHasher_,
        bytes32 emptyLeaf,
        uint64 treeVersion_
    ) external initializer {
        if (
            address(stateRegistry_) == address(0) || address(fieldHasher_) == address(0)
                || treeVersion_ == 0
        ) revert InvalidConfiguration();
        __ProtocolAccess_init(admin, upgrader);
        stateRegistry = stateRegistry_;
        fieldHasher = fieldHasher_;
        treeVersion = treeVersion_;
        _tree.initialize(fieldHasher_, emptyLeaf);
    }

    function setAssetConfig(address asset, uint128 denomination, bool enabled)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (asset == address(0) || denomination == 0) revert InvalidConfiguration();
        assetConfig[asset] = AssetConfig({ denomination: denomination, enabled: enabled });
        emit AssetConfigUpdated(asset, denomination, enabled);
    }

    function setPaused(bool paused_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        paused = paused_;
        emit PauseUpdated(paused_);
    }

    function setWithdrawalAdapter(WithdrawalVerifierAdapter adapter)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (address(adapter) == address(0)) revert InvalidConfiguration();
        withdrawalAdapter = adapter;
        emit WithdrawalAdapterUpdated(address(adapter));
    }

    function setLPManager(ShieldedLPManager manager, bool enabled)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (address(manager) == address(0) || manager.vault() != address(this)) {
            revert InvalidConfiguration();
        }
        address token0 = manager.token0();
        address token1 = manager.token1();
        if (enabled) {
            if (
                (address(lpManagerForAsset[token0]) != address(0)
                        && lpManagerForAsset[token0] != manager)
                    || (address(lpManagerForAsset[token1]) != address(0)
                        && lpManagerForAsset[token1] != manager)
            ) revert InvalidConfiguration();
            lpManagerForAsset[token0] = manager;
            lpManagerForAsset[token1] = manager;
            emit LPManagerUpdated(token0, address(manager));
            emit LPManagerUpdated(token1, address(manager));
        } else {
            if (manager.managedShares() != 0) revert InvalidConfiguration();
            if (lpManagerForAsset[token0] == manager) delete lpManagerForAsset[token0];
            if (lpManagerForAsset[token1] == manager) delete lpManagerForAsset[token1];
            emit LPManagerUpdated(token0, address(0));
            emit LPManagerUpdated(token1, address(0));
        }
    }

    function deposit(address asset, uint256 amount, bytes32 commitment)
        external
        nonReentrant
        returns (uint32 leafIndex, bytes32 newRoot)
    {
        if (paused) revert VaultPaused();
        AssetConfig memory config = assetConfig[asset];
        if (!config.enabled) revert AssetNotAllowed();
        if (amount != config.denomination) revert InvalidDenomination();
        if (IERC20Minimal(asset).allowance(msg.sender, address(this)) != amount) {
            revert AllowanceMustMatchAmount();
        }
        if (commitmentInserted[commitment]) revert CommitmentAlreadyExists();

        asset.pullExact(msg.sender, amount);
        liabilityRaw[asset] += amount;
        commitmentInserted[commitment] = true;
        (leafIndex, newRoot) = _tree.insert(fieldHasher, commitment);
        stateRegistry.registerRoot(treeVersion, newRoot);

        emit CommitmentDeposited(
            msg.sender, asset, amount, commitment, leafIndex, newRoot, treeVersion
        );
    }

    function root() external view returns (bytes32) {
        return _tree.root;
    }

    function withdraw(bytes calldata proof, uint256[13] calldata inputs)
        external
        nonReentrant
        returns (bytes32 nullifier)
    {
        if (paused) revert VaultPaused();
        WithdrawalVerifierAdapter adapter = withdrawalAdapter;
        if (address(adapter) == address(0)) revert WithdrawalUnavailable();

        WithdrawalContext memory context = _validateWithdrawalContext(inputs);

        nullifier = adapter.verifyAndConsume(proof, inputs, msg.sender);
        if (liabilityRaw[context.asset] < context.amount) revert InsolventAsset();
        liabilityRaw[context.asset] -= context.amount;
        _payWithdrawal(context);
        _emitWithdrawal(context, nullifier, inputs);
    }

    function nextLeafIndex() external view returns (uint64) {
        return _tree.nextLeafIndex;
    }

    function investAggregateLiquidity(
        ShieldedLPManager manager,
        uint256 amount0,
        uint256 amount1,
        uint256 minimumShares,
        uint256 deadline
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant returns (uint256 shares) {
        if (paused) revert VaultPaused();
        _requireAuthorizedManager(manager);
        address token0 = manager.token0();
        address token1 = manager.token1();
        token0.forceApprove(address(manager), amount0);
        token1.forceApprove(address(manager), amount1);
        shares = manager.invest(amount0, amount1, minimumShares, deadline);
        token0.forceApprove(address(manager), 0);
        token1.forceApprove(address(manager), 0);
        _requireSolvent(token0);
        _requireSolvent(token1);
        emit AggregateLiquidityInvested(address(manager), amount0, amount1, shares);
    }

    function divestAggregateLiquidity(
        ShieldedLPManager manager,
        uint256 shares,
        uint256 minimumAmount0,
        uint256 minimumAmount1,
        uint256 deadline
    )
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
        returns (uint256 amount0, uint256 amount1)
    {
        _requireAuthorizedManager(manager);
        (amount0, amount1) = manager.divest(shares, minimumAmount0, minimumAmount1, deadline);
        emit AggregateLiquidityDivested(address(manager), shares, amount0, amount1);
    }

    function accountedAssets(address asset)
        public
        view
        returns (uint256 liquid, uint256 managed, uint256 liability, bool solvent)
    {
        liquid = IERC20Minimal(asset).balanceOf(address(this));
        ShieldedLPManager manager = lpManagerForAsset[asset];
        if (address(manager) != address(0)) {
            (uint256 amount0, uint256 amount1) = manager.previewAssets();
            managed = asset == manager.token0() ? amount0 : amount1;
        }
        liability = liabilityRaw[asset];
        solvent = liquid + managed >= liability;
    }

    function _validateWithdrawalContext(uint256[13] calldata inputs)
        private
        view
        returns (WithdrawalContext memory context)
    {
        context = WithdrawalContext({
            asset: address(uint160(inputs[7])),
            recipient: address(uint160(inputs[9])),
            amount: inputs[8],
            relayerFee: inputs[11]
        });
        AssetConfig memory config = assetConfig[context.asset];
        if (!config.enabled) revert AssetNotAllowed();
        if (context.amount != config.denomination) revert InvalidDenomination();
        if (
            context.recipient == address(0) || context.recipient == address(this)
                || inputs[10] != uint160(msg.sender) || context.relayerFee > context.amount
        ) revert InvalidWithdrawalContext();
    }

    function _payWithdrawal(WithdrawalContext memory context) private {
        if (context.recipient == msg.sender) {
            context.asset.pushExact(context.recipient, context.amount);
            return;
        }

        context.asset.pushExact(context.recipient, context.amount - context.relayerFee);
        if (context.relayerFee != 0) {
            context.asset.pushExact(msg.sender, context.relayerFee);
        }
    }

    function _emitWithdrawal(
        WithdrawalContext memory context,
        bytes32 nullifier,
        uint256[13] calldata inputs
    ) private {
        emit NoteWithdrawn(
            context.asset,
            context.recipient,
            nullifier,
            context.amount,
            msg.sender,
            context.relayerFee,
            bytes32(inputs[5]),
            uint64(inputs[4])
        );
    }

    function _requireAuthorizedManager(ShieldedLPManager manager) private view {
        if (
            address(manager) == address(0) || manager.vault() != address(this)
                || lpManagerForAsset[manager.token0()] != manager
                || lpManagerForAsset[manager.token1()] != manager
        ) revert LPManagerUnavailable();
    }

    function _requireSolvent(address asset) private view {
        (,,, bool solvent) = accountedAssets(asset);
        if (!solvent) revert InsolventAsset();
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

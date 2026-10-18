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
        _payWithdrawal(context);
        _emitWithdrawal(context, nullifier, inputs);
    }

    function nextLeafIndex() external view returns (uint64) {
        return _tree.nextLeafIndex;
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

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

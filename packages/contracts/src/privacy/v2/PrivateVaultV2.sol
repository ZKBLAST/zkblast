// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../../access/ProtocolAccess.sol";
import { UUPSUpgradeable } from "../../proxy/UUPSUpgradeable.sol";
import { IFieldHasher } from "../../interfaces/IFieldHasher.sol";
import { IERC20Minimal } from "../../interfaces/IERC20Minimal.sol";
import { TokenTransfer } from "../../libraries/TokenTransfer.sol";
import { PoolRegistry } from "../../core/PoolRegistry.sol";
import { DammPool } from "../../core/DammPool.sol";
import { DlmmPool } from "../../core/DlmmPool.sol";
import { IncrementalCommitmentTree } from "../IncrementalCommitmentTree.sol";
import { VerifiedSettlementV2 } from "./VerifiedSettlementV2.sol";
import { SettlementTermsV2 } from "./SettlementTermsV2.sol";
import { IPrivateActionVerifierV2, IPrivateFundVerifierV2 } from "./PrivateProofVerifiersV2.sol";
import { IPrivateFieldHasherV2 } from "./Poseidon2FieldHasherV2.sol";

/// @notice Isolated UUPS v2 vault. Never initialize over a withdrawal-v1 proxy.
/// @dev Tree epoch and verifier references are pinned for the lifetime of this
/// release. No admin sweep, arbitrary call or live note migration entrypoint.
contract PrivateVaultV2 is VerifiedSettlementV2, ProtocolAccess, UUPSUpgradeable {
    using IncrementalCommitmentTree for IncrementalCommitmentTree.Tree;
    using TokenTransfer for address;

    error InvalidConfiguration();
    error Paused();
    error AssetUnavailable();
    error InvalidFundContext();
    error InvalidFundProof();
    error NoteUnavailable();
    error Insolvent();

    uint256 private constant FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 private constant ROOT_HISTORY = 256;

    uint64 public treeVersion;
    IFieldHasher public fieldHasher;
    IPrivateActionVerifierV2 public actionVerifier;
    IPrivateFundVerifierV2 public fundVerifier;
    PoolRegistry public poolRegistry;
    bool public depositsPaused;
    bool public actionsPaused;
    bool public withdrawalsPaused;
    IncrementalCommitmentTree.Tree private _tree;
    bytes32[ROOT_HISTORY] private _rootHistory;
    mapping(bytes32 root => uint256 count) private _rootReferences;
    uint256 private _rootCursor;
    mapping(address asset => bool enabled) public assetEnabled;
    mapping(address asset => uint256 liability) public liabilityRaw;
    mapping(bytes32 resource => uint256 liability) public shareLiability;
    mapping(bytes32 commitment => bool inserted) public commitmentInserted;
    mapping(bytes32 nullifier => bool spent) public withdrawalSpent;
    mapping(address adapter => bool authorized) public perpsAdapterAuthorized;

    event AssetEnabled(address indexed asset, bool enabled);
    event PauseUpdated(bool deposits, bool actions, bool withdrawals);
    event NoteInserted(bytes32 indexed commitment, uint32 leafIndex, bytes32 root);
    event Deposited(address indexed asset, uint256 amount, bytes32 indexed commitment);
    event Withdrawn(
        address indexed asset, address indexed recipient, uint256 amount, bytes32 indexed nullifier
    );
    event PerpsAdapterAuthorizationUpdated(address indexed adapter, bool authorized);
    event PerpsNoteConsumed(
        address indexed adapter, address indexed asset, bytes32 indexed nullifier, uint256 amount
    );
    event PerpsNoteInserted(
        address indexed adapter, address indexed asset, bytes32 indexed commitment, uint256 amount
    );

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        address upgrader,
        PoolRegistry registry,
        IFieldHasher hasher,
        IPrivateActionVerifierV2 actionVerifier_,
        IPrivateFundVerifierV2 fundVerifier_,
        uint64 treeVersion_
    ) external initializer {
        if (
            address(registry).code.length == 0 || address(hasher).code.length == 0
                || address(actionVerifier_).code.length == 0
                || address(fundVerifier_).code.length == 0 || treeVersion_ == 0
        ) revert InvalidConfiguration();
        if (IPrivateFieldHasherV2(address(hasher)).MERKLE_DOMAIN_V2() != 2002004) {
            revert InvalidConfiguration();
        }
        __ProtocolAccess_init(admin, upgrader);
        treeVersion = treeVersion_;
        poolRegistry = registry;
        fieldHasher = hasher;
        actionVerifier = actionVerifier_;
        fundVerifier = fundVerifier_;
        depositsPaused = true;
        actionsPaused = true;
        _tree.initialize(hasher, bytes32(uint256(1)));
        _rememberRoot(_tree.root);
    }

    function setAssetEnabled(address asset, bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (asset.code.length == 0) revert InvalidConfiguration();
        assetEnabled[asset] = enabled;
        emit AssetEnabled(asset, enabled);
    }

    function setPaused(bool deposits, bool actions, bool withdrawals)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        depositsPaused = deposits;
        actionsPaused = actions;
        withdrawalsPaused = withdrawals;
        emit PauseUpdated(deposits, actions, withdrawals);
    }

    function setPerpsAdapterAuthorization(address adapter, bool authorized)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (adapter == address(0) || (authorized && adapter.code.length == 0)) {
            revert InvalidConfiguration();
        }
        perpsAdapterAuthorized[adapter] = authorized;
        emit PerpsAdapterAuthorizationUpdated(adapter, authorized);
    }

    function consumePerpsNote(
        address asset,
        uint64 treeVersion_,
        bytes32 root,
        bytes32 nullifier,
        uint256 amount,
        address recipient
    ) external nonReentrant {
        if (!perpsAdapterAuthorized[msg.sender]) revert InvalidConfiguration();
        if (
            !assetEnabled[asset] || treeVersion_ != treeVersion || !isKnownRoot(root)
                || nullifier == bytes32(0) || amount == 0 || amount > type(uint128).max
                || recipient == address(0) || withdrawalSpent[nullifier]
                || nullifierIntent[nullifier] != bytes32(0)
        ) revert NoteUnavailable();
        withdrawalSpent[nullifier] = true;
        liabilityRaw[asset] -= amount;
        asset.pushExact(recipient, amount);
        _assertAssetSolvent(asset);
        emit PerpsNoteConsumed(msg.sender, asset, nullifier, amount);
    }

    function insertPerpsNote(address asset, uint256 amount, bytes32 commitment, address payer)
        external
        nonReentrant
    {
        if (!perpsAdapterAuthorized[msg.sender]) revert InvalidConfiguration();
        if (
            !assetEnabled[asset] || amount == 0 || amount > type(uint128).max
                || payer == address(0) || commitment == bytes32(0)
                || uint256(commitment) >= FIELD || commitmentInserted[commitment]
        ) revert NoteUnavailable();
        asset.pullExact(payer, amount);
        liabilityRaw[asset] += amount;
        _insert(commitment);
        _assertAssetSolvent(asset);
        emit PerpsNoteInserted(msg.sender, asset, commitment, amount);
    }

    function currentRoot() external view returns (bytes32) {
        return _tree.root;
    }

    function nextLeafIndex() external view returns (uint64) {
        return _tree.nextLeafIndex;
    }

    function isKnownRoot(bytes32 root) public view returns (bool) {
        return root != bytes32(0) && _rootReferences[root] != 0;
    }

    function deposit(bytes calldata proof, uint256[11] calldata p) external nonReentrant {
        if (depositsPaused) revert Paused();
        _fundContext(p, 0);
        address asset = address(uint160(p[7]));
        if (!assetEnabled[asset]) revert AssetUnavailable();
        if (p[5] != 0 || p[6] != 0 || p[9] != 0 || p[10] == 0) revert InvalidFundContext();
        if (!fundVerifier.verify(proof, p)) revert InvalidFundProof();
        if (commitmentInserted[bytes32(p[10])]) revert NoteUnavailable();
        asset.pullExact(msg.sender, p[8]);
        liabilityRaw[asset] += p[8];
        _insert(bytes32(p[10]));
        _assertAssetSolvent(asset);
        emit Deposited(asset, p[8], bytes32(p[10]));
    }

    function withdraw(bytes calldata proof, uint256[11] calldata p) external nonReentrant {
        if (withdrawalsPaused) revert Paused();
        _fundContext(p, 1);
        bytes32 nullifier = bytes32(p[6]);
        if (
            p[6] == 0 || p[9] == 0 || p[10] != 0 || !isKnownRoot(bytes32(p[5]))
                || withdrawalSpent[nullifier] || nullifierIntent[nullifier] != bytes32(0)
        ) revert NoteUnavailable();
        if (!fundVerifier.verify(proof, p)) revert InvalidFundProof();
        address asset = address(uint160(p[7]));
        withdrawalSpent[nullifier] = true;
        liabilityRaw[asset] -= p[8];
        asset.pushExact(address(uint160(p[9])), p[8]);
        _assertAssetSolvent(asset);
        emit Withdrawn(asset, address(uint160(p[9])), p[8], nullifier);
    }

    function _fundContext(uint256[11] calldata p, uint256 operation) private view {
        for (uint256 i; i < 11; ++i) {
            if (p[i] >= FIELD) revert InvalidFundContext();
        }
        if (
            p[0] != 2 || p[1] != operation || p[2] != block.chainid
                || p[3] != uint160(address(this)) || p[4] != treeVersion || p[7] == 0
                || p[7] > type(uint160).max || p[8] == 0 || p[8] > type(uint128).max
                || p[9] > type(uint160).max
        ) revert InvalidFundContext();
    }

    function _beforeReservation(SettlementTermsV2.Terms memory t, uint256[32] memory p)
        internal
        view
        override
    {
        _requireExecutionEnabled(t);
        for (uint256 i; i < 32; ++i) {
            if (p[i] >= FIELD) revert InvalidProofContext();
        }
        for (uint256 i; i < 3; ++i) {
            if (withdrawalSpent[bytes32(p[14 + i])]) revert NoteUnavailable();
            if (
                (p[17 + i] != 0 && commitmentInserted[bytes32(p[17 + i])])
                    || (p[20 + i] != 0 && commitmentInserted[bytes32(p[20 + i])])
            ) revert NoteUnavailable();
        }
    }

    function _beforeExecution(SettlementTermsV2.Terms memory t, uint256[32] memory)
        internal
        view
        override
    {
        _requireExecutionEnabled(t);
    }

    function _requireExecutionEnabled(SettlementTermsV2.Terms memory t) private view {
        if (actionsPaused) revert Paused();
        if (!assetEnabled[t.asset0] || !assetEnabled[t.asset1]) revert AssetUnavailable();
    }

    function _recordActionAccounting(uint256[32] memory p) internal override {
        address token0 = address(uint160(p[9]));
        address token1 = address(uint160(p[10]));
        liabilityRaw[token0] = liabilityRaw[token0] + p[23] - p[26] - p[29];
        liabilityRaw[token1] = liabilityRaw[token1] + p[24] - p[27] - p[30];
        bytes32 key = shareResource(
            address(uint160(p[11])), uint8(p[12]), int24(int256(p[13]) - int256(1 << 23))
        );
        shareLiability[key] = shareLiability[key] + p[25] - p[28];
    }

    function shareResource(address pool, uint8 model, int24 bin) public pure returns (bytes32) {
        return keccak256(abi.encode(pool, model, bin));
    }

    function _assertActionSolvent(uint256[32] memory p) internal view override {
        _assertAssetSolvent(address(uint160(p[9])));
        _assertAssetSolvent(address(uint160(p[10])));
        address pool = address(uint160(p[11]));
        int24 bin = int24(int256(p[13]) - int256(1 << 23));
        uint256 shares = p[12] == 0
            ? DammPool(pool).sharesOf(address(this))
            : DlmmPool(pool).sharesOf(bin, address(this));
        if (shares < shareLiability[shareResource(pool, uint8(p[12]), bin)]) revert Insolvent();
    }

    function _assertAssetSolvent(address asset) private view {
        if (IERC20Minimal(asset).balanceOf(address(this)) < liabilityRaw[asset]) {
            revert Insolvent();
        }
    }

    function _appendNotes(bytes32[3] memory commitments) internal override {
        for (uint256 i; i < 3; ++i) {
            if (commitments[i] != bytes32(0)) _insert(commitments[i]);
        }
    }

    function _insert(bytes32 commitment) private {
        if (commitmentInserted[commitment]) revert NoteUnavailable();
        (uint32 index, bytes32 root) = _tree.insert(fieldHasher, commitment);
        commitmentInserted[commitment] = true;
        _rememberRoot(root);
        emit NoteInserted(commitment, index, root);
    }

    function _rememberRoot(bytes32 root) private {
        bytes32 previous = _rootHistory[_rootCursor];
        if (previous != bytes32(0)) --_rootReferences[previous];
        _rootHistory[_rootCursor] = root;
        ++_rootReferences[root];
        _rootCursor = (_rootCursor + 1) % ROOT_HISTORY;
    }

    function _actionTreeVersion() internal view override returns (uint64) {
        return treeVersion;
    }

    function _isKnownActionRoot(bytes32 root) internal view override returns (bool) {
        return isKnownRoot(root);
    }

    function _verifyPrivateAction(bytes calldata proof, uint256[32] calldata p)
        internal
        view
        override
        returns (bool)
    {
        return actionVerifier.verify(proof, p);
    }

    function _actionPoolRegistry() internal view override returns (PoolRegistry) {
        return poolRegistry;
    }
    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

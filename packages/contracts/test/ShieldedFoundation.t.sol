// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IZkProofVerifier } from "../src/interfaces/IZkProofVerifier.sol";
import { IFieldHasher } from "../src/interfaces/IFieldHasher.sol";
import { IncrementalCommitmentTree } from "../src/privacy/IncrementalCommitmentTree.sol";
import { ShieldedStateRegistry } from "../src/privacy/ShieldedStateRegistry.sol";
import { VerifierRegistry } from "../src/privacy/VerifierRegistry.sol";
import { WithdrawalVerifierAdapter } from "../src/privacy/WithdrawalVerifierAdapter.sol";
import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";

contract DeterministicVerifierMock is IZkProofVerifier {
    bytes32 private immutable _proofHash;

    constructor(bytes memory acceptedProof) {
        _proofHash = keccak256(acceptedProof);
    }

    function verify(bytes calldata proof, uint256[13] calldata) external view returns (bool) {
        return keccak256(proof) == _proofHash;
    }
}

contract DeterministicFieldHasher is IFieldHasher {
    uint256 private constant FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    function hashMerkleNode(uint256 level, bytes32 left, bytes32 right)
        external
        pure
        returns (bytes32)
    {
        return bytes32(
            (uint256(keccak256(abi.encode("ZKBLAST_MERKLE_NODE_V1", level, left, right)))
                    % (FIELD - 1)) + 1
        );
    }
}

contract CommitmentTreeHarness {
    using IncrementalCommitmentTree for IncrementalCommitmentTree.Tree;

    IncrementalCommitmentTree.Tree private _tree;
    IFieldHasher private immutable _hasher;

    constructor(IFieldHasher hasher) {
        _hasher = hasher;
        _tree.initialize(hasher, bytes32(uint256(1)));
    }

    function insert(bytes32 commitment) external returns (uint32, bytes32) {
        return _tree.insert(_hasher, commitment);
    }

    function root() external view returns (bytes32) {
        return _tree.root;
    }

    function nextLeafIndex() external view returns (uint64) {
        return _tree.nextLeafIndex;
    }
}

contract VaultHarness {
    ShieldedStateRegistry private immutable _state;
    WithdrawalVerifierAdapter private immutable _adapter;

    constructor(ShieldedStateRegistry state_, WithdrawalVerifierAdapter adapter_) {
        _state = state_;
        _adapter = adapter_;
    }

    function registerRoot(uint64 treeVersion, bytes32 root) external {
        _state.registerRoot(treeVersion, root);
    }

    function withdraw(bytes calldata proof, uint256[13] calldata inputs, address relayer)
        external
        returns (bytes32)
    {
        return _adapter.verifyAndConsume(proof, inputs, relayer);
    }
}

contract ShieldedFoundationTest {
    bytes private constant VALID_PROOF = hex"5a4b424c415354";
    bytes32 private constant ROOT = bytes32(uint256(11));
    bytes32 private constant NULLIFIER = bytes32(uint256(22));
    uint64 private constant VERSION = 1;
    address private constant RELAYER = address(0xBEEF);

    ShieldedStateRegistry private stateRegistry;
    VerifierRegistry private verifierRegistry;
    WithdrawalVerifierAdapter private adapter;
    VaultHarness private vault;

    function setUp() public {
        stateRegistry = ShieldedStateRegistry(
            address(
                new ERC1967Proxy(
                    address(new ShieldedStateRegistry()),
                    abi.encodeCall(ShieldedStateRegistry.initialize, (address(this), address(this)))
                )
            )
        );
        verifierRegistry = VerifierRegistry(
            address(
                new ERC1967Proxy(
                    address(new VerifierRegistry()),
                    abi.encodeCall(VerifierRegistry.initialize, (address(this), address(this)))
                )
            )
        );
        adapter = new WithdrawalVerifierAdapter(verifierRegistry, stateRegistry);
        vault = new VaultHarness(stateRegistry, adapter);
        stateRegistry.setVaultAuthorization(address(vault), true);
        stateRegistry.setConsumerAuthorization(address(adapter), true);
        verifierRegistry.register(
            adapter.CIRCUIT_ID(),
            VERSION,
            address(new DeterministicVerifierMock(VALID_PROOF)),
            keccak256("circuit-v1"),
            keccak256("verification-key-v1")
        );
        vault.registerRoot(VERSION, ROOT);
    }

    function testValidProofConsumesNullifierOnce() external {
        uint256[13] memory inputs = _inputs(ROOT, NULLIFIER);
        bytes32 consumed = vault.withdraw(VALID_PROOF, inputs, RELAYER);
        require(consumed == NULLIFIER, "wrong nullifier");
        require(
            stateRegistry.isNullifierSpent(address(vault), VERSION, NULLIFIER),
            "nullifier not spent"
        );

        (bool replaySuccess,) = address(vault)
            .call(abi.encodeCall(VaultHarness.withdraw, (VALID_PROOF, inputs, RELAYER)));
        require(!replaySuccess, "repeated nullifier accepted");
    }

    function testRejectsAlteredProofAndContext() external {
        uint256[13] memory inputs = _inputs(ROOT, NULLIFIER);
        (bool proofSuccess,) =
            address(vault).call(abi.encodeCall(VaultHarness.withdraw, (hex"00", inputs, RELAYER)));
        require(!proofSuccess, "altered proof accepted");

        inputs[1] = 2;
        (bool actionSuccess,) = address(vault)
            .call(abi.encodeCall(VaultHarness.withdraw, (VALID_PROOF, inputs, RELAYER)));
        require(!actionSuccess, "wrong action accepted");

        inputs = _inputs(ROOT, NULLIFIER);
        inputs[2] = block.chainid + 1;
        (bool chainSuccess,) = address(vault)
            .call(abi.encodeCall(VaultHarness.withdraw, (VALID_PROOF, inputs, RELAYER)));
        require(!chainSuccess, "wrong chain accepted");
    }

    function testRejectsUnknownAndExpiredRoots() external {
        uint256[13] memory unknownInputs = _inputs(bytes32(uint256(999)), NULLIFIER);
        (bool unknownSuccess,) = address(vault)
            .call(abi.encodeCall(VaultHarness.withdraw, (VALID_PROOF, unknownInputs, RELAYER)));
        require(!unknownSuccess, "unknown root accepted");

        for (uint256 index = 0; index < stateRegistry.ROOT_HISTORY_SIZE(); ++index) {
            vault.registerRoot(VERSION, bytes32(index + 100));
        }
        require(!stateRegistry.isKnownRoot(address(vault), VERSION, ROOT), "stale root retained");
        uint256[13] memory staleInputs = _inputs(ROOT, NULLIFIER);
        (bool staleSuccess,) = address(vault)
            .call(abi.encodeCall(VaultHarness.withdraw, (VALID_PROOF, staleInputs, RELAYER)));
        require(!staleSuccess, "stale root accepted");
    }

    function testVerifierVersionIsImmutableAndCanBeDisabled() external {
        (bool replaceSuccess,) = address(verifierRegistry)
            .call(
                abi.encodeCall(
                    VerifierRegistry.register,
                    (
                        adapter.CIRCUIT_ID(),
                        VERSION,
                        address(new DeterministicVerifierMock(VALID_PROOF)),
                        keccak256("other-circuit"),
                        keccak256("other-key")
                    )
                )
            );
        require(!replaceSuccess, "verifier version replaced");

        verifierRegistry.setActive(adapter.CIRCUIT_ID(), VERSION, false);
        uint256[13] memory inputs = _inputs(ROOT, NULLIFIER);
        (bool inactiveSuccess,) = address(vault)
            .call(abi.encodeCall(VaultHarness.withdraw, (VALID_PROOF, inputs, RELAYER)));
        require(!inactiveSuccess, "inactive verifier accepted");
    }

    function testIncrementalTreeProducesOrderedRoots() external {
        CommitmentTreeHarness tree = new CommitmentTreeHarness(new DeterministicFieldHasher());
        bytes32 emptyRoot = tree.root();
        (uint32 firstIndex, bytes32 firstRoot) = tree.insert(bytes32(uint256(101)));
        (uint32 secondIndex, bytes32 secondRoot) = tree.insert(bytes32(uint256(202)));

        require(firstIndex == 0 && secondIndex == 1, "wrong leaf order");
        require(firstRoot != emptyRoot && secondRoot != firstRoot, "root did not advance");
        require(tree.nextLeafIndex() == 2, "wrong next index");
    }

    function _inputs(bytes32 root, bytes32 nullifier)
        private
        view
        returns (uint256[13] memory inputs)
    {
        inputs[0] = 1;
        inputs[1] = 1;
        inputs[2] = block.chainid;
        inputs[3] = uint160(address(vault));
        inputs[4] = VERSION;
        inputs[5] = uint256(root);
        inputs[6] = uint256(nullifier);
        inputs[7] = uint160(address(0xCAFE));
        inputs[8] = 1 ether;
        inputs[9] = uint160(address(0xA11CE));
        inputs[10] = uint160(RELAYER);
        inputs[11] = 0.01 ether;
        inputs[12] = block.timestamp + 1 hours;
    }
}

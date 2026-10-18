// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IZkProofVerifier } from "../src/interfaces/IZkProofVerifier.sol";
import { IERC20Minimal } from "../src/interfaces/IERC20Minimal.sol";
import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";
import { Poseidon2FieldHasher } from "../src/privacy/Poseidon2FieldHasher.sol";
import { ShieldedStateRegistry } from "../src/privacy/ShieldedStateRegistry.sol";
import { VerifierRegistry } from "../src/privacy/VerifierRegistry.sol";
import { WithdrawalVerifierAdapter } from "../src/privacy/WithdrawalVerifierAdapter.sol";
import { ZKBlastVault } from "../src/privacy/ZKBlastVault.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";

contract WithdrawalVerifierMock is IZkProofVerifier {
    bytes32 private immutable _acceptedProof;

    constructor(bytes memory proof) {
        _acceptedProof = keccak256(proof);
    }

    function verify(bytes calldata proof, uint256[13] calldata) external view returns (bool) {
        return keccak256(proof) == _acceptedProof;
    }
}

contract WithdrawalFeeToken is IERC20Minimal {
    mapping(address account => uint256 balance) private _balance;

    function mint(address recipient, uint256 amount) external {
        _balance[recipient] += amount;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balance[account];
    }

    function allowance(address, address) external pure returns (uint256) {
        return type(uint256).max;
    }

    function approve(address, uint256) external pure returns (bool) {
        return true;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        _balance[msg.sender] -= amount;
        _balance[recipient] += amount - 1;
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount)
        external
        returns (bool)
    {
        _balance[sender] -= amount;
        _balance[recipient] += amount - 1;
        return true;
    }
}

contract ZKBlastVaultWithdrawalTest {
    bytes private constant VALID_PROOF = hex"5a4b424c4153542d5749544844524157";
    uint128 private constant DENOMINATION = 100 ether;
    uint64 private constant VERSION = 1;
    address private constant RECIPIENT = address(0xA11CE);

    ShieldedStateRegistry private stateRegistry;
    VerifierRegistry private verifierRegistry;
    WithdrawalVerifierAdapter private adapter;
    ZKBlastVault private vault;
    MockERC20 private token;
    bytes32 private acceptedRoot;

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
        vault = ZKBlastVault(
            address(
                new ERC1967Proxy(
                    address(new ZKBlastVault()),
                    abi.encodeCall(
                        ZKBlastVault.initialize,
                        (
                            address(this),
                            address(this),
                            stateRegistry,
                            new Poseidon2FieldHasher(),
                            bytes32(uint256(1)),
                            VERSION
                        )
                    )
                )
            )
        );
        adapter = new WithdrawalVerifierAdapter(verifierRegistry, stateRegistry);
        stateRegistry.setVaultAuthorization(address(vault), true);
        stateRegistry.setConsumerAuthorization(address(adapter), true);
        verifierRegistry.register(
            adapter.CIRCUIT_ID(),
            VERSION,
            address(new WithdrawalVerifierMock(VALID_PROOF)),
            keccak256("withdraw-circuit-v1"),
            keccak256("withdraw-vk-v1")
        );
        vault.setWithdrawalAdapter(adapter);
        token = new MockERC20("Vault Asset", "VLT");
        token.mint(address(this), DENOMINATION);
        vault.setAssetConfig(address(token), DENOMINATION, true);
        token.approve(address(vault), DENOMINATION);
        (, acceptedRoot) = vault.deposit(address(token), DENOMINATION, bytes32(uint256(777)));
    }

    function testWithdrawConsumesBeforeExactPayoutAndPaysRelayer() external {
        bytes32 nullifier = bytes32(uint256(901));
        uint256 fee = 1 ether;
        uint256 relayerBefore = token.balanceOf(address(this));
        uint256[13] memory inputs = _inputs(nullifier, RECIPIENT, fee);

        require(vault.withdraw(VALID_PROOF, inputs) == nullifier, "wrong nullifier");
        require(token.balanceOf(RECIPIENT) == DENOMINATION - fee, "wrong recipient payout");
        require(token.balanceOf(address(this)) - relayerBefore == fee, "wrong relayer payout");
        require(token.balanceOf(address(vault)) == 0, "vault balance not debited");
        require(
            stateRegistry.isNullifierSpent(address(vault), VERSION, nullifier),
            "nullifier not spent"
        );
    }

    function testRejectsReplayAlteredProofAndUnknownRoot() external {
        uint256[13] memory inputs = _inputs(bytes32(uint256(902)), RECIPIENT, 0);
        _expectFailure(hex"00", inputs);

        inputs[5] = uint256(bytes32(uint256(1234)));
        _expectFailure(VALID_PROOF, inputs);

        inputs = _inputs(bytes32(uint256(902)), RECIPIENT, 0);
        vault.withdraw(VALID_PROOF, inputs);
        _expectFailure(VALID_PROOF, inputs);
    }

    function testRejectsWrongChainVaultAssetAmountRecipientRelayerAndDeadline() external {
        uint256[13] memory inputs = _inputs(bytes32(uint256(903)), RECIPIENT, 0);
        inputs[2] = block.chainid + 1;
        _expectFailure(VALID_PROOF, inputs);
        inputs = _inputs(bytes32(uint256(904)), RECIPIENT, 0);
        inputs[3] = uint160(address(0xBAD));
        _expectFailure(VALID_PROOF, inputs);
        inputs = _inputs(bytes32(uint256(905)), RECIPIENT, 0);
        inputs[7] = uint160(address(0xCAFE));
        _expectFailure(VALID_PROOF, inputs);
        inputs = _inputs(bytes32(uint256(906)), RECIPIENT, 0);
        inputs[8] = DENOMINATION - 1;
        _expectFailure(VALID_PROOF, inputs);
        inputs = _inputs(bytes32(uint256(907)), address(0), 0);
        _expectFailure(VALID_PROOF, inputs);
        inputs = _inputs(bytes32(uint256(908)), RECIPIENT, 0);
        inputs[10] = uint160(address(0xBEEF));
        _expectFailure(VALID_PROOF, inputs);
        inputs = _inputs(bytes32(uint256(909)), RECIPIENT, 0);
        inputs[12] = block.timestamp - 1;
        _expectFailure(VALID_PROOF, inputs);
    }

    function testRejectsMalformedDomainAndExcessiveFee() external {
        uint256[13] memory inputs = _inputs(bytes32(uint256(910)), RECIPIENT, 0);
        inputs[0] = 2;
        _expectFailure(VALID_PROOF, inputs);
        inputs = _inputs(bytes32(uint256(911)), RECIPIENT, 0);
        inputs[1] = 2;
        _expectFailure(VALID_PROOF, inputs);
        inputs = _inputs(bytes32(uint256(912)), RECIPIENT, 0);
        inputs[4] = VERSION + 1;
        _expectFailure(VALID_PROOF, inputs);
        inputs = _inputs(bytes32(uint256(913)), RECIPIENT, DENOMINATION + 1);
        _expectFailure(VALID_PROOF, inputs);
    }

    function testToxicTokenPayoutRevertsAndRollsBackNullifier() external {
        WithdrawalFeeToken toxic = new WithdrawalFeeToken();
        bytes32 nullifier = bytes32(uint256(914));
        toxic.mint(address(vault), DENOMINATION);
        vault.setAssetConfig(address(toxic), DENOMINATION, true);

        uint256[13] memory inputs = _inputs(nullifier, RECIPIENT, 0);
        inputs[7] = uint160(address(toxic));
        _expectFailure(VALID_PROOF, inputs);

        require(toxic.balanceOf(address(vault)) == DENOMINATION, "vault balance changed");
        require(toxic.balanceOf(RECIPIENT) == 0, "recipient balance changed");
        require(
            !stateRegistry.isNullifierSpent(address(vault), VERSION, nullifier),
            "nullifier was not rolled back"
        );
    }

    function _inputs(bytes32 nullifier, address recipient, uint256 fee)
        private
        view
        returns (uint256[13] memory inputs)
    {
        inputs = [
            uint256(1),
            uint256(1),
            block.chainid,
            uint160(address(vault)),
            VERSION,
            uint256(acceptedRoot),
            uint256(nullifier),
            uint160(address(token)),
            DENOMINATION,
            uint160(recipient),
            uint160(address(this)),
            fee,
            block.timestamp + 1 hours
        ];
    }

    function _expectFailure(bytes memory proof, uint256[13] memory inputs) private {
        (bool success,) =
            address(vault).call(abi.encodeCall(ZKBlastVault.withdraw, (proof, inputs)));
        require(!success, "withdraw unexpectedly succeeded");
    }
}

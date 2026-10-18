// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20Minimal } from "../src/interfaces/IERC20Minimal.sol";
import { IFieldHasher } from "../src/interfaces/IFieldHasher.sol";
import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";
import { ShieldedStateRegistry } from "../src/privacy/ShieldedStateRegistry.sol";
import { ZKBlastVault } from "../src/privacy/ZKBlastVault.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";

contract VaultFieldHasher is IFieldHasher {
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

contract FeeOnTransferToken is IERC20Minimal {
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    function mint(address recipient, uint256 amount) external {
        balanceOf[recipient] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        _transfer(msg.sender, recipient, amount);
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount)
        external
        returns (bool)
    {
        allowance[sender][msg.sender] -= amount;
        _transfer(sender, recipient, amount);
        return true;
    }

    function _transfer(address sender, address recipient, uint256 amount) private {
        balanceOf[sender] -= amount;
        balanceOf[recipient] += amount - 1;
    }
}

contract ZKBlastVaultDepositTest {
    uint128 private constant DENOMINATION = 100 ether;
    uint64 private constant TREE_VERSION = 1;

    ShieldedStateRegistry private stateRegistry;
    ZKBlastVault private vault;
    MockERC20 private token;

    function setUp() public {
        stateRegistry = ShieldedStateRegistry(
            address(
                new ERC1967Proxy(
                    address(new ShieldedStateRegistry()),
                    abi.encodeCall(ShieldedStateRegistry.initialize, (address(this), address(this)))
                )
            )
        );
        VaultFieldHasher hasher = new VaultFieldHasher();
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
                            hasher,
                            bytes32(uint256(1)),
                            TREE_VERSION
                        )
                    )
                )
            )
        );
        stateRegistry.setVaultAuthorization(address(vault), true);
        token = new MockERC20("Vault Asset", "VLT");
        token.mint(address(this), DENOMINATION * 4);
        vault.setAssetConfig(address(token), DENOMINATION, true);
    }

    function testDepositPullsExactAmountAndRegistersRoot() external {
        bytes32 commitment = bytes32(uint256(101));
        token.approve(address(vault), DENOMINATION);
        (uint32 leafIndex, bytes32 root) = vault.deposit(address(token), DENOMINATION, commitment);

        require(leafIndex == 0, "wrong leaf index");
        require(vault.nextLeafIndex() == 1, "leaf count not advanced");
        require(token.balanceOf(address(vault)) == DENOMINATION, "wrong vault balance");
        require(vault.commitmentInserted(commitment), "commitment not recorded");
        require(
            stateRegistry.isKnownRoot(address(vault), TREE_VERSION, root), "root not registered"
        );
    }

    function testRejectsNonExactAllowanceAndDuplicateCommitment() external {
        bytes32 commitment = bytes32(uint256(202));
        token.approve(address(vault), DENOMINATION + 1);
        _expectDepositFailure(address(token), DENOMINATION, commitment);

        token.approve(address(vault), DENOMINATION);
        vault.deposit(address(token), DENOMINATION, commitment);
        token.approve(address(vault), DENOMINATION);
        _expectDepositFailure(address(token), DENOMINATION, commitment);
    }

    function testRejectsUnsupportedAssetAmountAndPausedVault() external {
        MockERC20 other = new MockERC20("Other", "OTH");
        other.mint(address(this), DENOMINATION);
        other.approve(address(vault), DENOMINATION);
        _expectDepositFailure(address(other), DENOMINATION, bytes32(uint256(301)));

        token.approve(address(vault), DENOMINATION - 1);
        _expectDepositFailure(address(token), DENOMINATION - 1, bytes32(uint256(302)));

        vault.setPaused(true);
        token.approve(address(vault), DENOMINATION);
        _expectDepositFailure(address(token), DENOMINATION, bytes32(uint256(303)));
    }

    function testRejectsFeeOnTransferTokenWithoutAdvancingTree() external {
        FeeOnTransferToken toxic = new FeeOnTransferToken();
        toxic.mint(address(this), DENOMINATION);
        vault.setAssetConfig(address(toxic), DENOMINATION, true);
        toxic.approve(address(vault), DENOMINATION);

        _expectDepositFailure(address(toxic), DENOMINATION, bytes32(uint256(401)));
        require(vault.nextLeafIndex() == 0, "tree advanced after failed transfer");
        require(toxic.balanceOf(address(vault)) == 0, "partial transfer retained");
    }

    function _expectDepositFailure(address asset, uint256 amount, bytes32 commitment) private {
        (bool success,) =
            address(vault).call(abi.encodeCall(ZKBlastVault.deposit, (asset, amount, commitment)));
        require(!success, "deposit unexpectedly succeeded");
    }
}

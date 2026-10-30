// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ShieldedPerpAdapter } from "../src/perps/ShieldedPerpAdapter.sol";
import { PerpEngine } from "../src/perps/PerpEngine.sol";
import { LiquidityVaultUSDG } from "../src/perps/LiquidityVaultUSDG.sol";
import { IPrivatePerpVerifier } from "../src/perps/interfaces/IPrivatePerpVerifier.sol";
import { IPrivatePerpCustody } from "../src/perps/interfaces/IPrivatePerpCustody.sol";
import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";

interface VmPerps {
    function warp(uint256 timestamp) external;
}

contract PerpVerifierMock is IPrivatePerpVerifier {
    function verify(bytes calldata proof, uint256[] calldata) external pure returns (bool) {
        return keccak256(proof) == keccak256("valid");
    }
}

contract PerpCustodyMock is IPrivatePerpCustody {
    MockERC20 public immutable token;
    uint64 public constant treeVersion = 2;
    mapping(bytes32 => bool) public spent;
    mapping(bytes32 => bool) public inserted;

    constructor(MockERC20 token_) { token = token_; }
    function isKnownRoot(bytes32 root) external pure returns (bool) { return root == bytes32(uint256(7)); }
    function consumePerpsNote(address, uint64, bytes32, bytes32 nullifier, uint256 amount, address recipient) external {
        require(!spent[nullifier], "spent");
        spent[nullifier] = true;
        token.transfer(recipient, amount);
    }
    function insertPerpsNote(address, uint256 amount, bytes32 commitment, address payer) external {
        require(!inserted[commitment], "inserted");
        inserted[commitment] = true;
        token.transferFrom(payer, address(this), amount);
    }
}

contract PerpVaultMock {
    MockERC20 public immutable token;
    constructor(MockERC20 token_) { token = token_; }
    function closePublicPosition(bytes32, bytes32, uint128, uint64, address recipient)
        external
        returns (PerpEngine.CloseResult memory result)
    {
        result.payoutUsd = 1_000;
        token.transfer(recipient, result.payoutUsd);
    }
}

contract ShieldedPerpAdapterTest {
    VmPerps private constant vm = VmPerps(address(uint160(uint256(keccak256("hevm cheat code")))));
    MockERC20 private token;
    PerpCustodyMock private custody;
    PerpVaultMock private vault;
    ShieldedPerpAdapter private adapter;

    function setUp() public {
        vm.warp(1_800_000_000);
        token = new MockERC20("USDG", "USDG");
        custody = new PerpCustodyMock(token);
        vault = new PerpVaultMock(token);
        PerpVerifierMock verifier = new PerpVerifierMock();
        ShieldedPerpAdapter implementation = new ShieldedPerpAdapter();
        adapter = ShieldedPerpAdapter(address(new ERC1967Proxy(
            address(implementation),
            abi.encodeCall(
                ShieldedPerpAdapter.initialize,
                (address(this),address(this),address(token),LiquidityVaultUSDG(address(vault)),custody,verifier,verifier,verifier,verifier)
            )
        )));
        token.mint(address(vault), 10_000);
    }

    function testRejectsExpiredOpenBeforeProofOrCustodyMutation() external {
        uint256[21] memory p;
        p[0] = 1; p[1] = 1; p[2] = block.chainid; p[3] = uint160(address(adapter));
        p[4] = uint160(address(custody)); p[5] = uint160(address(token));
        p[6] = 2; p[7] = 7; p[14] = block.timestamp;
        (bool success,) = address(adapter).call(abi.encodeCall(adapter.openPrivatePosition, (bytes("valid"), p)));
        require(!success, "expired open accepted");
    }

    function testCloseConsumesPositionNullifierOnceAndInsertsPrivatePayout() external {
        uint256[17] memory p;
        p[0] = 1; p[1] = 2; p[2] = block.chainid; p[3] = uint160(address(adapter));
        p[4] = uint160(address(custody)); p[5] = uint160(address(token)); p[6] = 2;
        p[9] = 11; p[10] = 12; p[11] = 1_000; p[12] = 1;
        p[13] = block.timestamp + 60; p[14] = 13; p[15] = uint160(address(this)); p[16] = 1;
        adapter.closePrivatePosition(bytes("valid"), p);
        require(adapter.positionNullifierSpent(bytes32(uint256(12))), "nullifier not spent");
        require(custody.inserted(bytes32(uint256(13))), "payout note missing");
        (bool success,) = address(adapter).call(abi.encodeCall(adapter.closePrivatePosition, (bytes("valid"), p)));
        require(!success, "position nullifier reused");
    }
}

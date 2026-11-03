// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DammPool } from "../src/core/DammPool.sol";
import { DlmmPool } from "../src/core/DlmmPool.sol";
import {
    ProtectedLPAllocationEscrow
} from "../src/launchpad/protection/ProtectedLPAllocationEscrow.sol";
import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";

interface VmProtectedEscrow {
    function warp(uint256 timestamp) external;
}

contract MockDammReceiptPool {
    mapping(address account => uint256 shares) public sharesOf;

    function setShares(address account, uint256 shares) external {
        sharesOf[account] = shares;
    }

    function removeLiquidity(
        uint256 shares,
        uint256 minimumAmount0,
        uint256 minimumAmount1,
        address,
        uint256 deadline
    ) external returns (uint256 amount0, uint256 amount1) {
        require(block.timestamp <= deadline, "deadline");
        amount0 = shares * 2;
        amount1 = shares * 3;
        require(amount0 >= minimumAmount0 && amount1 >= minimumAmount1, "slippage");
        sharesOf[msg.sender] -= shares;
    }
}

contract MockDlmmReceiptPool {
    mapping(int24 binId => mapping(address account => uint256 shares)) private _shares;

    function sharesOf(int24 binId, address account) external view returns (uint256) {
        return _shares[binId][account];
    }

    function setShares(int24 binId, address account, uint256 shares) external {
        _shares[binId][account] = shares;
    }

    function removeLiquidity(
        int24 binId,
        uint256 shares,
        uint256 minimumAmount0,
        uint256 minimumAmount1,
        address,
        uint256 deadline
    ) external returns (uint256 amount0, uint256 amount1) {
        require(block.timestamp <= deadline, "deadline");
        amount0 = shares * 4;
        amount1 = shares * 5;
        require(amount0 >= minimumAmount0 && amount1 >= minimumAmount1, "slippage");
        _shares[binId][msg.sender] -= shares;
    }
}

contract ProtectedLPAllocationEscrowTest {
    VmProtectedEscrow private constant vm =
        VmProtectedEscrow(address(uint160(uint256(keccak256("hevm cheat code")))));
    ProtectedLPAllocationEscrow private escrow;
    MockDammReceiptPool private damm;
    MockDlmmReceiptPool private dlmm;
    bytes32 private constant POLICY_HASH = keccak256("PROTECTED_POLICY");

    function setUp() public {
        escrow = ProtectedLPAllocationEscrow(
            address(
                new ERC1967Proxy(
                    address(new ProtectedLPAllocationEscrow()),
                    abi.encodeCall(
                        ProtectedLPAllocationEscrow.initialize, (address(this), address(this))
                    )
                )
            )
        );
        escrow.setRole(escrow.MANAGER_ROLE(), address(this), true);
        damm = new MockDammReceiptPool();
        dlmm = new MockDlmmReceiptPool();
    }

    function testDammCreatorPrincipalIsLockedAndProtocolRemainsClaimable() external {
        bytes32 migrationId = keccak256("DAMM");
        damm.setShares(address(escrow), 1_000);
        uint64 unlockAt = uint64(block.timestamp + 30 days);
        escrow.registerDammAllocation(
            migrationId,
            DammPool(address(damm)),
            1,
            POLICY_HASH,
            address(this),
            address(this),
            600,
            400,
            unlockAt,
            1_000
        );

        (bool early,) = address(escrow)
            .call(
                abi.encodeCall(
                    ProtectedLPAllocationEscrow.claim, (migrationId, true, 0, 0, block.timestamp)
                )
            );
        require(!early, "creator principal unlocked early");
        (uint256 protocol0, uint256 protocol1) =
            escrow.claim(migrationId, false, 800, 1_200, block.timestamp);
        require(protocol0 == 800 && protocol1 == 1_200, "protocol allocation");

        vm.warp(unlockAt);
        (uint256 creator0, uint256 creator1) =
            escrow.claim(migrationId, true, 1_200, 1_800, block.timestamp);
        require(creator0 == 1_200 && creator1 == 1_800, "creator allocation");
        require(damm.sharesOf(address(escrow)) == 0, "receipt balance");
    }

    function testRejectsMissingReceiptsMinimumSharesAndDuplicateRegistration() external {
        bytes32 migrationId = keccak256("BOUNDS");
        damm.setShares(address(escrow), 99);
        (bool insufficient,) = address(escrow)
            .call(
                abi.encodeCall(
                    ProtectedLPAllocationEscrow.registerDammAllocation,
                    (
                        migrationId,
                        DammPool(address(damm)),
                        1,
                        POLICY_HASH,
                        address(this),
                        address(this),
                        60,
                        40,
                        uint64(block.timestamp + 1 days),
                        100
                    )
                )
            );
        require(!insufficient, "missing receipts accepted");

        damm.setShares(address(escrow), 100);
        escrow.registerDammAllocation(
            migrationId,
            DammPool(address(damm)),
            1,
            POLICY_HASH,
            address(this),
            address(this),
            60,
            40,
            uint64(block.timestamp + 1 days),
            100
        );
        (bool duplicate,) = address(escrow)
            .call(
                abi.encodeCall(
                    ProtectedLPAllocationEscrow.registerDammAllocation,
                    (
                        migrationId,
                        DammPool(address(damm)),
                        1,
                        POLICY_HASH,
                        address(this),
                        address(this),
                        60,
                        40,
                        uint64(block.timestamp + 1 days),
                        100
                    )
                )
            );
        require(!duplicate, "duplicate allocation accepted");
    }

    function testDlmmReceiptAndBinAreBound() external {
        bytes32 migrationId = keccak256("DLMM");
        int24 binId = 7;
        dlmm.setShares(binId, address(escrow), 500);
        uint64 unlockAt = uint64(block.timestamp + 1 days);
        escrow.registerDlmmAllocation(
            migrationId,
            DlmmPool(address(dlmm)),
            binId,
            2,
            POLICY_HASH,
            address(this),
            address(this),
            300,
            200,
            unlockAt,
            500
        );
        ProtectedLPAllocationEscrow.Allocation memory allocation = escrow.getAllocation(migrationId);
        require(allocation.isDlmm && allocation.binId == binId, "DLMM binding");
        require(allocation.policyHash == POLICY_HASH && allocation.policyId == 2, "policy binding");

        (bool early,) = address(escrow)
            .call(
                abi.encodeCall(
                    ProtectedLPAllocationEscrow.claim, (migrationId, true, 0, 0, block.timestamp)
                )
            );
        require(!early, "DLMM creator principal unlocked early");
        (uint256 protocol0, uint256 protocol1) =
            escrow.claim(migrationId, false, 800, 1_000, block.timestamp);
        require(protocol0 == 800 && protocol1 == 1_000, "DLMM protocol allocation");

        vm.warp(unlockAt);
        (uint256 creator0, uint256 creator1) =
            escrow.claim(migrationId, true, 1_200, 1_500, block.timestamp);
        require(creator0 == 1_200 && creator1 == 1_500, "DLMM creator allocation");
        require(dlmm.sharesOf(binId, address(escrow)) == 0, "DLMM receipt balance");
    }

    function testClaimHonorsMinimumOutputSlippage() external {
        bytes32 migrationId = keccak256("SLIPPAGE");
        damm.setShares(address(escrow), 100);
        escrow.registerDammAllocation(
            migrationId,
            DammPool(address(damm)),
            1,
            POLICY_HASH,
            address(this),
            address(this),
            60,
            40,
            uint64(block.timestamp + 1 days),
            100
        );
        (bool success,) = address(escrow)
            .call(
                abi.encodeCall(
                    ProtectedLPAllocationEscrow.claim,
                    (migrationId, false, 81, 121, block.timestamp)
                )
            );
        require(!success, "slippage bypass");
    }
}

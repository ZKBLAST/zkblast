// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DbcTypes } from "../src/dbc/DbcTypes.sol";
import { IGraduationAdapter } from "../src/dbc/IGraduationAdapter.sol";
import { ProtectedGraduationManager } from "../src/dbc/ProtectedGraduationManager.sol";
import { ProtectedVirtualPool } from "../src/dbc/ProtectedVirtualPool.sol";
import { ProtectedLaunchFactory } from "../src/launchpad/protection/ProtectedLaunchFactory.sol";
import {
    ProtectedLPAllocationEscrow
} from "../src/launchpad/protection/ProtectedLPAllocationEscrow.sol";
import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";

contract ProtectedGraduationTokenMock {
    uint256 public totalSupply;
    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    function mint(address recipient, uint256 amount) external {
        totalSupply += amount;
        balanceOf[recipient] += amount;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount)
        external
        returns (bool)
    {
        uint256 approved = allowance[sender][msg.sender];
        if (approved != type(uint256).max) allowance[sender][msg.sender] = approved - amount;
        balanceOf[sender] -= amount;
        balanceOf[recipient] += amount;
        return true;
    }
}

contract ProtectedGraduationFactoryMock {
    mapping(address pool => bytes32 launchId) public launchByPool;

    function bind(address pool, bytes32 launchId) external {
        launchByPool[pool] = launchId;
    }
}

contract ProtectedGraduationPoolMock {
    ProtectedGraduationTokenMock public immutable baseToken;
    ProtectedGraduationTokenMock public immutable quoteToken;
    DbcTypes.TemplateConfig private _config;

    constructor(ProtectedGraduationTokenMock baseToken_, ProtectedGraduationTokenMock quoteToken_) {
        baseToken = baseToken_;
        quoteToken = quoteToken_;
        _config.quoteToken = address(quoteToken_);
        _config.protocolLpRecipient = address(0x1003);
        _config.baseDecimals = 18;
        _config.quoteDecimals = 6;
        _config.migrationMode = DbcTypes.MigrationMode.DAMM;
        _config.destinationFeePips = 3_000;
        _config.terminalPriceToleranceBps = 100;
        _config.minimumDestinationShares = 1;
        _config.curve.segmentCount = 1;
        _config.curve.segments[0] = DbcTypes.LinearSegment({
            initialPriceX18: 0.01e18, slopeX18: 0, saleCapacityX18: 100e18
        });
    }

    function config() external view returns (DbcTypes.TemplateConfig memory) {
        return _config;
    }

    function lifecycle() external pure returns (DbcTypes.Lifecycle) {
        return DbcTypes.Lifecycle.GRADUATION_READY;
    }

    function accounting()
        external
        pure
        returns (uint128, uint128, uint128, uint128, uint128, uint128, uint128)
    {
        return (10e18, 1_000_000, 0, 0, 0, 0, 0);
    }

    function releaseMigrationAssets(address recipient, uint256 baseAmount, uint256 quoteAmount)
        external
    {
        baseToken.transfer(recipient, baseAmount);
        quoteToken.transfer(recipient, quoteAmount);
    }
}

contract ReentrantSlippageAdapterMock is IGraduationAdapter {
    ProtectedGraduationManager public immutable manager;
    ProtectedVirtualPool public immutable source;

    constructor(ProtectedGraduationManager manager_, ProtectedVirtualPool source_) {
        manager = manager_;
        source = source_;
    }

    function migrationMode() external pure returns (DbcTypes.MigrationMode) {
        return DbcTypes.MigrationMode.DAMM;
    }

    function adapterVersion() external pure returns (uint32) {
        return 1;
    }

    function factory() external view returns (address) {
        return address(this);
    }

    function configurationHash() external pure returns (bytes32) {
        return keccak256("REENTRANT_SLIPPAGE_ADAPTER");
    }

    function migrate(Migration calldata migration) external returns (address, uint256, int24) {
        (bool success,) = address(manager)
            .call(
                abi.encodeCall(
                    ProtectedGraduationManager.graduate, (source, this, migration.deadline)
                )
            );
        if (success) revert("REENTRANCY_ACCEPTED");
        revert("SLIPPAGE_EXCEEDED");
    }
}

contract ProtectedGraduationManagerTest {
    bytes32 private constant LAUNCH_ID = keccak256("PROTECTED_GRADUATION");
    ProtectedGraduationManager private manager;
    ProtectedGraduationPoolMock private pool;
    ReentrantSlippageAdapterMock private adapter;

    function setUp() public {
        ProtectedGraduationTokenMock base = new ProtectedGraduationTokenMock();
        ProtectedGraduationTokenMock quote = new ProtectedGraduationTokenMock();
        pool = new ProtectedGraduationPoolMock(base, quote);
        base.mint(address(pool), 100e18);
        quote.mint(address(pool), 1_000_000);

        ProtectedGraduationFactoryMock factory = new ProtectedGraduationFactoryMock();
        factory.bind(address(pool), LAUNCH_ID);
        ProtectedLPAllocationEscrow escrow = ProtectedLPAllocationEscrow(
            address(
                new ERC1967Proxy(
                    address(new ProtectedLPAllocationEscrow()),
                    abi.encodeCall(
                        ProtectedLPAllocationEscrow.initialize, (address(this), address(this))
                    )
                )
            )
        );
        manager = ProtectedGraduationManager(
            address(
                new ERC1967Proxy(
                    address(new ProtectedGraduationManager()),
                    abi.encodeCall(
                        ProtectedGraduationManager.initialize,
                        (
                            address(this),
                            address(this),
                            ProtectedLaunchFactory(address(factory)),
                            escrow
                        )
                    )
                )
            )
        );
        adapter = new ReentrantSlippageAdapterMock(manager, ProtectedVirtualPool(address(pool)));
        manager.setAdapter(address(adapter), true);
    }

    function testSlippageFailureIsRetrySafeAndRejectsReentrantOrParallelExecution() external {
        bytes32 migrationId = keccak256(abi.encode(address(manager), LAUNCH_ID, address(adapter)));
        (address destination, uint256 shares) =
            manager.graduate(ProtectedVirtualPool(address(pool)), adapter, block.timestamp);
        require(destination == address(0) && shares == 0, "failure escaped");
        (ProtectedGraduationManager.MigrationStatus status, uint8 attempts, bytes32 failureHash) =
            manager.migrationAttemptState(migrationId);
        require(status == ProtectedGraduationManager.MigrationStatus.PENDING_RETRY, "status");
        require(
            attempts == 1
                && failureHash
                    == keccak256(abi.encodeWithSignature("Error(string)", "SLIPPAGE_EXCEEDED")),
            "failure or reentrancy receipt"
        );

        (bool parallel,) = address(manager)
            .call(
                abi.encodeCall(
                    ProtectedGraduationManager.graduate,
                    (ProtectedVirtualPool(address(pool)), adapter, block.timestamp)
                )
            );
        require(!parallel, "parallel execution accepted");
        manager.retryGraduation(migrationId, block.timestamp);
        manager.retryGraduation(migrationId, block.timestamp);
        (status, attempts,) = manager.migrationAttemptState(migrationId);
        require(
            status == ProtectedGraduationManager.MigrationStatus.FAILED_NEEDS_REVIEW, "review state"
        );
        require(attempts == 3, "attempt count");

        (bool retryAgain,) = address(manager)
            .call(
                abi.encodeCall(
                    ProtectedGraduationManager.retryGraduation, (migrationId, block.timestamp)
                )
            );
        require(!retryAgain, "fourth attempt accepted");
        (bool externalExecute,) = address(manager)
            .call(
                abi.encodeCall(
                    ProtectedGraduationManager.executeGraduation,
                    (
                        ProtectedVirtualPool(address(pool)),
                        adapter,
                        block.timestamp,
                        migrationId,
                        LAUNCH_ID
                    )
                )
            );
        require(!externalExecute, "self-call boundary bypassed");
    }
}

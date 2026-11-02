// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DammPool } from "../src/core/DammPool.sol";
import { PoolFactory } from "../src/core/PoolFactory.sol";
import { PoolRegistry } from "../src/core/PoolRegistry.sol";
import { DammGraduationAdapter } from "../src/dbc/DammGraduationAdapter.sol";
import { DlmmGraduationAdapter } from "../src/dbc/DlmmGraduationAdapter.sol";
import { IGraduationAdapter } from "../src/dbc/IGraduationAdapter.sol";
import { DlmmPool } from "../src/core/DlmmPool.sol";
import { DbcTypes } from "../src/dbc/DbcTypes.sol";
import { GraduationManager } from "../src/dbc/GraduationManager.sol";
import { LaunchConfigRegistry } from "../src/dbc/LaunchConfigRegistry.sol";
import { LaunchFactory } from "../src/dbc/LaunchFactory.sol";
import { LaunchTokenDeployer } from "../src/dbc/LaunchTokenDeployer.sol";
import { VirtualPoolDeployer } from "../src/dbc/VirtualPoolDeployer.sol";
import { LaunchToken } from "../src/dbc/LaunchToken.sol";
import { LPAllocationEscrow } from "../src/dbc/LPAllocationEscrow.sol";
import { VirtualPool } from "../src/dbc/VirtualPool.sol";
import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";

interface VmGraduation {
    function warp(uint256 timestamp) external;
}

contract GraduationUsdg {
    uint8 public immutable decimals;
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    constructor(uint8 decimals_) {
        decimals = decimals_;
    }

    function mint(address recipient, uint256 amount) external {
        balanceOf[recipient] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
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

contract GraduationBindingMock {
    struct Binding {
        uint256 launchpadId;
        uint256 configPresetId;
        bytes32 configHash;
        bytes32 feeSnapshotId;
        address creator;
        address treasury;
        address token;
        address virtualPool;
        uint8 graduationDestination;
    }

    mapping(bytes32 launchId => Binding item) private _bindings;
    mapping(address pool => bytes32 launchId) public launchByPool;

    function set(bytes32 launchId, address token, address pool) external {
        _bindings[launchId] = Binding({
            launchpadId: 7,
            configPresetId: 3,
            configHash: keccak256("CONFIG"),
            feeSnapshotId: keccak256("FEES"),
            creator: msg.sender,
            treasury: msg.sender,
            token: token,
            virtualPool: pool,
            graduationDestination: 1
        });
        launchByPool[pool] = launchId;
    }

    function binding(bytes32 launchId) external view returns (Binding memory) {
        return _bindings[launchId];
    }
}

contract DbcGraduationTest {
    VmGraduation private constant vm =
        VmGraduation(address(uint160(uint256(keccak256("hevm cheat code")))));

    GraduationUsdg private usdg;
    LaunchConfigRegistry private configRegistry;
    LaunchFactory private launchFactory;
    PoolRegistry private poolRegistry;
    PoolFactory private poolFactory;
    LPAllocationEscrow private escrow;
    GraduationManager private manager;
    DammGraduationAdapter private adapter;
    uint256 private templateId;

    function setUp() public {
        usdg = new GraduationUsdg(6);
        configRegistry = LaunchConfigRegistry(
            address(
                new ERC1967Proxy(
                    address(new LaunchConfigRegistry()),
                    abi.encodeCall(
                        LaunchConfigRegistry.initialize,
                        (address(this), address(this), address(this))
                    )
                )
            )
        );
        configRegistry.setQuoteToken(address(usdg), true);
        templateId = configRegistry.createTemplate(keccak256("USDG_LINEAR"), _config());
        LaunchTokenDeployer tokenDeployer = new LaunchTokenDeployer(address(this));
        VirtualPoolDeployer poolDeployer = new VirtualPoolDeployer(address(this));
        launchFactory = LaunchFactory(
            address(
                new ERC1967Proxy(
                    address(new LaunchFactory()),
                    abi.encodeCall(
                        LaunchFactory.initialize,
                        (address(this), address(this), configRegistry, tokenDeployer, poolDeployer)
                    )
                )
            )
        );
        tokenDeployer.bindFactory(address(launchFactory));
        poolDeployer.bindFactory(address(launchFactory));
        configRegistry.setRole(configRegistry.FACTORY_ROLE(), address(launchFactory), true);

        poolRegistry = PoolRegistry(
            address(
                new ERC1967Proxy(
                    address(new PoolRegistry()),
                    abi.encodeCall(
                        PoolRegistry.initialize, (address(this), address(this), address(this))
                    )
                )
            )
        );
        poolFactory = PoolFactory(
            address(
                new ERC1967Proxy(
                    address(new PoolFactory()),
                    abi.encodeCall(
                        PoolFactory.initialize, (address(this), address(this), poolRegistry)
                    )
                )
            )
        );
        poolRegistry.setRole(poolRegistry.FACTORY_ROLE(), address(poolFactory), true);

        escrow = LPAllocationEscrow(
            address(
                new ERC1967Proxy(
                    address(new LPAllocationEscrow()),
                    abi.encodeCall(LPAllocationEscrow.initialize, (address(this), address(this)))
                )
            )
        );
        manager = GraduationManager(
            address(
                new ERC1967Proxy(
                    address(new GraduationManager()),
                    abi.encodeCall(
                        GraduationManager.initialize,
                        (address(this), address(this), launchFactory, escrow)
                    )
                )
            )
        );
        escrow.setRole(escrow.MANAGER_ROLE(), address(manager), true);
        adapter = new DammGraduationAdapter(address(manager), poolFactory);
        manager.setAdapter(address(adapter), true);
        launchFactory.setGraduationManager(address(manager));
        usdg.mint(address(this), 3_000_000);
    }

    function testGraduatesExactlyOnceAndEscrowsExactShares() external {
        (bytes32 launchId, address tokenAddress, address sourceAddress) = _launchReady();
        VirtualPool source = VirtualPool(sourceAddress);
        uint256 protocolQuoteBefore = usdg.balanceOf(address(this));
        (address destination, uint256 shares) = manager.graduate(source, adapter, block.timestamp);

        require(source.lifecycle() == DbcTypes.Lifecycle.GRADUATED, "not graduated");
        require(poolRegistry.isRegisteredPool(destination), "DAMM not registered");
        require(DammPool(destination).sharesOf(address(escrow)) == shares, "shares not escrowed");
        require(LaunchToken(tokenAddress).balanceOf(sourceAddress) == 0, "base left in source");
        (, uint128 realReserve,,,,,) = source.accounting();
        require(realReserve == 0, "quote reserve left in source");
        require(usdg.balanceOf(address(manager)) == 0, "manager quote residue");
        require(LaunchToken(tokenAddress).balanceOf(address(manager)) == 0, "manager base residue");
        require(usdg.balanceOf(address(adapter)) == 0, "adapter quote residue");
        require(LaunchToken(tokenAddress).balanceOf(address(adapter)) == 0, "adapter base residue");
        require(usdg.balanceOf(address(this)) > protocolQuoteBefore, "surplus not disposed");

        DbcTypes.GraduationState memory graduation = source.graduationState();
        require(graduation.destinationPool == destination, "destination mismatch");
        require(graduation.destinationShares == shares, "share mismatch");
        require(manager.migrationCompleted(graduation.migrationId), "migration unrecorded");
        require(manager.accountingReconciles(graduation.migrationId), "accounting mismatch");
        require(launchId != bytes32(0), "launch id");

        (bool secondSuccess,) = address(manager)
            .call(abi.encodeCall(GraduationManager.graduate, (source, adapter, block.timestamp)));
        require(!secondSuccess, "double graduation accepted");
    }

    function testRejectedAttemptIsRetrySafeAndClaimsOnlyRecordedAllocation() external {
        (, address tokenAddress, address sourceAddress) = _launchReady();
        VirtualPool source = VirtualPool(sourceAddress);
        DammGraduationAdapter blockedAdapter =
            new DammGraduationAdapter(address(manager), poolFactory);
        (bool blockedSuccess,) = address(manager)
            .call(
                abi.encodeCall(
                    GraduationManager.graduate, (source, blockedAdapter, block.timestamp)
                )
            );
        require(!blockedSuccess, "blocked adapter accepted");
        require(source.lifecycle() == DbcTypes.Lifecycle.GRADUATION_READY, "state mutated");
        require(LaunchToken(tokenAddress).balanceOf(sourceAddress) != 0, "inventory moved");

        (address destination,) = manager.graduate(source, adapter, block.timestamp);
        DbcTypes.GraduationState memory graduation = source.graduationState();
        LPAllocationEscrow.Allocation memory allocation =
            escrow.getAllocation(graduation.migrationId);
        require(
            uint256(allocation.creatorShares) + allocation.protocolShares
                == DammPool(destination).sharesOf(address(escrow)),
            "allocation mismatch"
        );
        uint256 quoteBefore = usdg.balanceOf(address(this));
        escrow.claim(graduation.migrationId, false, block.timestamp);
        require(usdg.balanceOf(address(this)) > quoteBefore, "protocol claim missing");
        (bool earlyCreatorClaim,) = address(escrow)
            .call(
                abi.encodeCall(
                    LPAllocationEscrow.claim, (graduation.migrationId, true, block.timestamp)
                )
            );
        require(!earlyCreatorClaim, "creator lock bypassed");
        vm.warp(block.timestamp + 30 days);
        escrow.claim(graduation.migrationId, true, block.timestamp);
    }

    function testGraduationRequiresExactThresholdAndOvershootIsBounded() external {
        LaunchFactory.LaunchRequest memory request = LaunchFactory.LaunchRequest({
            templateId: templateId,
            salt: keccak256("threshold-stages"),
            name: "ZKBLAST Staged Launch",
            symbol: "ZKS",
            metadataURI: "ipfs://zkblast-staged-launch",
            creatorTokenRecipient: address(this)
        });
        (,, address sourceAddress) = launchFactory.createLaunch(request);
        VirtualPool source = VirtualPool(sourceAddress);
        usdg.approve(sourceAddress, type(uint256).max);

        (bool zeroProgressSuccess,) = address(manager)
            .call(abi.encodeCall(GraduationManager.graduate, (source, adapter, block.timestamp)));
        require(!zeroProgressSuccess, "zero-progress graduation");

        VirtualPool.BuyQuote memory stagedQuote = source.quoteBuyExactInput(505_050);
        source.buyExactInput(
            505_050,
            stagedQuote.baseOutRaw,
            stagedQuote.finalPriceX18,
            address(this),
            block.timestamp
        );
        (bool partialSuccess,) = address(manager)
            .call(abi.encodeCall(GraduationManager.graduate, (source, adapter, block.timestamp)));
        require(!partialSuccess, "partial graduation");

        VirtualPool.BuyQuote memory finalQuote = source.quoteBuyExactInput(2_000_000);
        require(finalQuote.grossQuoteConsumedRaw < 2_000_000, "overshoot not bounded");
        source.buyExactInput(
            2_000_000,
            finalQuote.baseOutRaw,
            finalQuote.finalPriceX18,
            address(this),
            block.timestamp
        );
        require(source.graduationProgressBps() == 10_000, "threshold not exact");
        manager.graduate(source, adapter, block.timestamp);
        require(source.lifecycle() == DbcTypes.Lifecycle.GRADUATED, "retry failed");
    }

    function testPersistsFailedAttemptAndPermissionlessRetryCompletes() external {
        vm.warp(100);
        (bytes32 launchId, address tokenAddress, address sourceAddress) = _launchReady();
        VirtualPool source = VirtualPool(sourceAddress);
        bytes32 migrationId = keccak256(abi.encode(address(manager), launchId, address(adapter)));
        uint256 baseBefore = LaunchToken(tokenAddress).balanceOf(sourceAddress);
        uint256 quoteBefore = usdg.balanceOf(sourceAddress);

        (address failedDestination, uint256 failedShares) = manager.graduate(source, adapter, 99);
        require(failedDestination == address(0) && failedShares == 0, "failure not recorded");
        (GraduationManager.MigrationStatus status, uint8 attempts, bytes32 failureHash) =
            manager.migrationAttemptState(migrationId);
        require(status == GraduationManager.MigrationStatus.PENDING_RETRY, "not retryable");
        require(attempts == 1 && failureHash != bytes32(0), "failure receipt missing");
        require(LaunchToken(tokenAddress).balanceOf(sourceAddress) == baseBefore, "base moved");
        require(usdg.balanceOf(sourceAddress) == quoteBefore, "quote moved");

        (address destination, uint256 shares) = manager.retryGraduation(migrationId, 100);
        require(destination != address(0) && shares != 0, "retry failed");
        (status, attempts, failureHash) = manager.migrationAttemptState(migrationId);
        require(status == GraduationManager.MigrationStatus.GRADUATED, "not graduated");
        require(attempts == 2 && failureHash == bytes32(0), "receipt not finalized");
    }

    function testBindsLaunchpadContextIntoMigrationReceipt() external {
        (bytes32 launchId, address tokenAddress, address sourceAddress) = _launchReady();
        GraduationBindingMock resolver = new GraduationBindingMock();
        resolver.set(launchId, tokenAddress, sourceAddress);
        manager.setLaunchpadBindingResolver(address(resolver));

        manager.graduate(VirtualPool(sourceAddress), adapter, block.timestamp);
        bytes32 migrationId = keccak256(abi.encode(address(manager), launchId, address(adapter)));
        (uint256 launchpadId, bytes32 configHash, bytes32 feeSnapshotId, uint8 destination) =
            manager.migrationContext(migrationId);
        require(launchpadId == 7, "launchpad id");
        require(configHash == keccak256("CONFIG"), "config hash");
        require(feeSnapshotId == keccak256("FEES"), "fee snapshot");
        require(destination == 1, "destination");
    }

    function testThreeFailuresRequireReviewBeforeFinalSuccess() external {
        vm.warp(200);
        (bytes32 launchId,, address sourceAddress) = _launchReady();
        VirtualPool source = VirtualPool(sourceAddress);
        bytes32 migrationId = keccak256(abi.encode(address(manager), launchId, address(adapter)));

        manager.graduate(source, adapter, 199);
        (bool concurrentSuccess,) = address(manager)
            .call(abi.encodeCall(GraduationManager.graduate, (source, adapter, 200)));
        require(!concurrentSuccess, "parallel migration accepted");
        manager.retryGraduation(migrationId, 199);
        manager.retryGraduation(migrationId, 199);
        (GraduationManager.MigrationStatus status, uint8 attempts,) =
            manager.migrationAttemptState(migrationId);
        require(status == GraduationManager.MigrationStatus.FAILED_NEEDS_REVIEW, "review missing");
        require(attempts == 3, "attempt count");
        (bool unreviewedRetry,) = address(manager)
            .call(abi.encodeCall(GraduationManager.retryGraduation, (migrationId, 200)));
        require(!unreviewedRetry, "review bypassed");

        manager.reopenMigration(migrationId);
        (address destination, uint256 shares) = manager.retryGraduation(migrationId, 200);
        require(destination != address(0) && shares != 0, "reviewed retry failed");
        (status, attempts,) = manager.migrationAttemptState(migrationId);
        require(status == GraduationManager.MigrationStatus.GRADUATED, "not finalized");
        require(attempts == 1, "reopened attempt count");
    }

    function testVersionedDlmmAdapterSeedsExactBinAndTransfersAdministration() external {
        GraduationUsdg base = new GraduationUsdg(18);
        GraduationUsdg quote = new GraduationUsdg(18);
        base.mint(address(this), 2e18);
        quote.mint(address(this), 2e18);
        DlmmGraduationAdapter dlmmAdapter =
            new DlmmGraduationAdapter(address(this), poolFactory, address(this), 25);
        base.approve(address(dlmmAdapter), type(uint256).max);
        quote.approve(address(dlmmAdapter), type(uint256).max);
        IGraduationAdapter.Migration memory migration = IGraduationAdapter.Migration({
            baseToken: address(base),
            quoteToken: address(quote),
            baseDecimals: 18,
            quoteDecimals: 18,
            feePips: 3_000,
            toleranceBps: 100,
            baseAmount: 2e18,
            quoteAmount: 2e18,
            expectedPriceX18: 1e18,
            minimumShares: 1,
            lpRecipient: address(escrow),
            deadline: block.timestamp
        });
        (address destination, uint256 shares, int24 binId) = dlmmAdapter.migrate(migration);
        DlmmPool pool = DlmmPool(destination);
        require(binId == 0 && pool.activeBin() == 0, "active bin");
        require(pool.sharesOf(binId, address(escrow)) == shares, "shares");
        require(pool.administrator() == address(this), "administrator");
        require(pool.protocolFeeRecipient() == address(this), "fee recipient");
        require(base.balanceOf(address(dlmmAdapter)) == 0, "base dust");
        require(quote.balanceOf(address(dlmmAdapter)) == 0, "quote dust");
    }

    function testDlmmGraduationRetriesEscrowsPerBinAndCannotMigrateTwice() external {
        vm.warp(1_000);
        (GraduationUsdg quote, VirtualPool source, DlmmGraduationAdapter dlmmAdapter, bytes32 launchId)
        = _launchDlmmReady();
        bytes32 migrationId =
            keccak256(abi.encode(address(manager), launchId, address(dlmmAdapter)));
        (address failedPool, uint256 failedShares) =
            manager.graduate(source, dlmmAdapter, block.timestamp - 1);
        require(failedPool == address(0) && failedShares == 0, "failure not retained");
        (address destination, uint256 shares) =
            manager.retryGraduation(migrationId, block.timestamp);
        (
            address snapshotFactory,
            bytes32 snapshotConfigHash,
            uint32 snapshotVersion,
            DbcTypes.MigrationMode snapshotMode
        ) = manager.adapterSnapshots(migrationId);
        require(snapshotFactory == address(poolFactory), "factory snapshot");
        require(snapshotConfigHash == dlmmAdapter.configurationHash(), "config snapshot");
        require(snapshotVersion == 1, "version snapshot");
        require(snapshotMode == DbcTypes.MigrationMode.DLMM, "mode snapshot");
        _assertDlmmEscrow(migrationId, destination, shares);
        require(manager.accountingReconciles(migrationId), "accounting mismatch");
        (bool duplicateSuccess,) = address(manager).call(
            abi.encodeCall(GraduationManager.graduate, (source, dlmmAdapter, block.timestamp))
        );
        require(!duplicateSuccess, "double migration accepted");

        uint256 quoteBefore = quote.balanceOf(address(this));
        escrow.claim(migrationId, false, block.timestamp);
        require(quote.balanceOf(address(this)) > quoteBefore, "DLMM claim missing");
    }

    function _launchDlmmReady()
        private
        returns (
            GraduationUsdg quote,
            VirtualPool source,
            DlmmGraduationAdapter dlmmAdapter,
            bytes32 launchId
        )
    {
        quote = new GraduationUsdg(18);
        quote.mint(address(this), 3e18);
        configRegistry.setQuoteToken(address(quote), true);
        DbcTypes.TemplateConfig memory dlmmConfig = _config();
        dlmmConfig.quoteToken = address(quote);
        dlmmConfig.quoteDecimals = 18;
        dlmmConfig.migrationMode = DbcTypes.MigrationMode.DLMM;
        dlmmConfig.graduationThresholdRaw = 1e18;
        uint256 dlmmTemplate =
            configRegistry.createTemplate(keccak256("USDG_DLMM_LINEAR"), dlmmConfig);
        dlmmAdapter = new DlmmGraduationAdapter(address(manager), poolFactory, address(this), 25);
        manager.setAdapter(address(dlmmAdapter), true);

        LaunchFactory.LaunchRequest memory request = LaunchFactory.LaunchRequest({
            templateId: dlmmTemplate,
            salt: keccak256("dlmm-manager-graduation"),
            name: "ZKBLAST DLMM Launch",
            symbol: "ZKDL",
            metadataURI: "ipfs://zkblast-dlmm-launch",
            creatorTokenRecipient: address(this)
        });
        address sourceAddress;
        (launchId,, sourceAddress) = launchFactory.createLaunch(request);
        source = VirtualPool(sourceAddress);
        quote.approve(sourceAddress, type(uint256).max);
        VirtualPool.BuyQuote memory buyQuote = source.quoteBuyExactInput(2e18);
        source.buyExactInput(
            2e18,
            buyQuote.baseOutRaw,
            buyQuote.finalPriceX18,
            address(this),
            block.timestamp
        );
        require(source.lifecycle() == DbcTypes.Lifecycle.GRADUATION_READY, "not ready");
    }

    function _assertDlmmEscrow(bytes32 migrationId, address destination, uint256 shares)
        private
        view
    {
        LPAllocationEscrow.Allocation memory allocation = escrow.getAllocation(migrationId);
        int24 binId = escrow.dlmmBinByMigration(migrationId);
        require(escrow.dlmmAllocation(migrationId), "not DLMM allocation");
        require(allocation.pool == destination, "destination mismatch");
        require(
            DlmmPool(destination).sharesOf(binId, address(escrow)) == shares,
            "escrow shares"
        );
    }

    function _launchReady()
        private
        returns (bytes32 launchId, address tokenAddress, address sourceAddress)
    {
        LaunchFactory.LaunchRequest memory request = LaunchFactory.LaunchRequest({
            templateId: templateId,
            salt: keccak256(abi.encode(block.number, usdg.balanceOf(address(this)))),
            name: "ZKBLAST Launch",
            symbol: "ZKL",
            metadataURI: "ipfs://zkblast-launch",
            creatorTokenRecipient: address(this)
        });
        (launchId, tokenAddress, sourceAddress) = launchFactory.createLaunch(request);
        usdg.approve(sourceAddress, type(uint256).max);
        VirtualPool source = VirtualPool(sourceAddress);
        VirtualPool.BuyQuote memory quote = source.quoteBuyExactInput(2_000_000);
        source.buyExactInput(
            2_000_000, quote.baseOutRaw, quote.finalPriceX18, address(this), block.timestamp
        );
        require(source.lifecycle() == DbcTypes.Lifecycle.GRADUATION_READY, "threshold");
    }

    function _config() private view returns (DbcTypes.TemplateConfig memory config) {
        config.quoteToken = address(usdg);
        config.protocolFeeRecipient = address(this);
        config.partnerFeeRecipient = address(0x1002);
        config.protocolLpRecipient = address(this);
        config.quoteDecimals = 6;
        config.baseDecimals = 18;
        config.migrationMode = DbcTypes.MigrationMode.DAMM;
        config.destinationFeePips = 3_000;
        config.terminalPriceToleranceBps = 100;
        config.totalSupplyRaw = 1_000e18;
        config.baseInventoryRaw = 100e18;
        config.graduationThresholdRaw = 1_000_000;
        config.minimumDestinationShares = 1;
        config.curve.segmentCount = 1;
        config.curve.segments[0] = DbcTypes.LinearSegment({
            initialPriceX18: 0.01e18, slopeX18: 0.00001e18, saleCapacityX18: 100e18
        });
        config.fees = DbcTypes.FeePolicy({
            tradeFeeBps: 100,
            creatorShareBps: 4_000,
            partnerShareBps: 2_000,
            protocolShareBps: 4_000
        });
        config.lp = DbcTypes.LpPolicy({
            creatorShareBps: 5_000, protocolShareBps: 5_000, creatorLockSeconds: 30 days
        });
    }
}

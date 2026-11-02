// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DbcTypes } from "../src/dbc/DbcTypes.sol";
import { LaunchConfigRegistry } from "../src/dbc/LaunchConfigRegistry.sol";
import { CurveQuoter } from "../src/dbc/CurveQuoter.sol";
import { LaunchFactory } from "../src/dbc/LaunchFactory.sol";
import { LaunchTokenDeployer } from "../src/dbc/LaunchTokenDeployer.sol";
import { VirtualPool } from "../src/dbc/VirtualPool.sol";
import { VirtualPoolDeployer } from "../src/dbc/VirtualPoolDeployer.sol";
import { LaunchpadConfigManager } from "../src/launchpad/LaunchpadConfigManager.sol";
import { LaunchpadFeeController } from "../src/launchpad/LaunchpadFeeController.sol";
import { LaunchpadFeeCollector } from "../src/launchpad/LaunchpadFeeCollector.sol";
import { LaunchpadRegistry } from "../src/launchpad/LaunchpadRegistry.sol";
import { LaunchpadTokenFactory } from "../src/launchpad/LaunchpadTokenFactory.sol";
import { RevenueSplitter } from "../src/launchpad/RevenueSplitter.sol";
import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";
import { IERC20Minimal } from "../src/interfaces/IERC20Minimal.sol";

contract PermissionlessLaunchCreator {
    function create(
        LaunchpadTokenFactory factory,
        LaunchpadTokenFactory.LaunchpadLaunchRequest calldata request
    ) external returns (bytes32 launchId) {
        (launchId,,,) = factory.createLaunch(request);
    }

    function tryCreate(
        LaunchpadTokenFactory factory,
        LaunchpadTokenFactory.LaunchpadLaunchRequest calldata request
    ) external returns (bool success) {
        (success,) = address(factory).call(
            abi.encodeCall(LaunchpadTokenFactory.createLaunch, (request))
        );
    }
}

contract LaunchpadTokenFactoryTest {
    MockERC20 private usdg;
    LaunchConfigRegistry private dbcRegistry;
    LaunchFactory private dbcFactory;
    LaunchpadRegistry private launchpadRegistry;
    LaunchpadConfigManager private configManager;
    LaunchpadFeeController private feeController;
    RevenueSplitter private revenueSplitter;
    LaunchpadFeeCollector private feeCollector;
    LaunchpadTokenFactory private tokenFactory;
    uint256 private templateId;
    uint256 private presetId;
    uint256 private launchpadId;

    function setUp() public {
        usdg = new MockERC20("Global Dollar", "USDG");
        dbcRegistry = LaunchConfigRegistry(
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
        dbcRegistry.setQuoteToken(address(usdg), true);
        templateId = dbcRegistry.createTemplate(keccak256("USDG_LINEAR"), _dbcConfig());
        LaunchTokenDeployer tokenDeployer = new LaunchTokenDeployer(address(this));
        VirtualPoolDeployer poolDeployer = new VirtualPoolDeployer(address(this));
        dbcFactory = LaunchFactory(
            address(
                new ERC1967Proxy(
                    address(new LaunchFactory()),
                    abi.encodeCall(
                        LaunchFactory.initialize,
                        (
                            address(this),
                            address(this),
                            dbcRegistry,
                            tokenDeployer,
                            poolDeployer
                        )
                    )
                )
            )
        );
        tokenDeployer.bindFactory(address(dbcFactory));
        poolDeployer.bindFactory(address(dbcFactory));
        dbcRegistry.setRole(dbcRegistry.FACTORY_ROLE(), address(dbcFactory), true);

        configManager = LaunchpadConfigManager(
            address(
                new ERC1967Proxy(
                    address(new LaunchpadConfigManager()),
                    abi.encodeCall(
                        LaunchpadConfigManager.initialize,
                        (address(this), address(this), address(this))
                    )
                )
            )
        );
        configManager.setQuoteToken(address(usdg), true);
        presetId = configManager.createPreset(
            LaunchpadConfigManager.PresetInput({
                familyId: keccak256("USDG_DAMM"),
                dbcTemplateId: templateId,
                quoteToken: address(usdg),
                maximumTotalTradeFeeBps: 100,
                graduationDestination: LaunchpadConfigManager.GraduationDestination.DAMM,
                creatorAccess: LaunchpadConfigManager.CreatorAccess.OWNER_OR_OPERATOR,
                maximumLaunches: 2
            })
        );
        launchpadRegistry = LaunchpadRegistry(
            address(
                new ERC1967Proxy(
                    address(new LaunchpadRegistry()),
                    abi.encodeCall(
                        LaunchpadRegistry.initialize,
                        (address(this), address(this), address(this))
                    )
                )
            )
        );
        launchpadId = launchpadRegistry.registerLaunchpad(
            address(this),
            address(0x7007),
            keccak256("launchpad metadata"),
            keccak256("bound-launchpad"),
            presetId
        );
        feeController = LaunchpadFeeController(
            address(
                new ERC1967Proxy(
                    address(new LaunchpadFeeController()),
                    abi.encodeCall(
                        LaunchpadFeeController.initialize,
                        (
                            address(this),
                            address(this),
                            launchpadRegistry,
                            address(0x9009)
                        )
                    )
                )
            )
        );
        feeController.setLaunchpadFeePolicy(
            launchpadId,
            100,
            LaunchpadFeeController.FeeShares({
                protocolShareBps: 4_000,
                operatorShareBps: 2_000,
                creatorShareBps: 4_000,
                referralShareBps: 0
            }),
            address(0x8008)
        );
        revenueSplitter = RevenueSplitter(
            address(
                new ERC1967Proxy(
                    address(new RevenueSplitter()),
                    abi.encodeCall(
                        RevenueSplitter.initialize, (address(this), address(this))
                    )
                )
            )
        );
        feeCollector = LaunchpadFeeCollector(
            address(
                new ERC1967Proxy(
                    address(new LaunchpadFeeCollector()),
                    abi.encodeCall(
                        LaunchpadFeeCollector.initialize,
                        (address(this), address(this), revenueSplitter)
                    )
                )
            )
        );
        tokenFactory = LaunchpadTokenFactory(
            address(
                new ERC1967Proxy(
                    address(new LaunchpadTokenFactory()),
                    abi.encodeCall(
                        LaunchpadTokenFactory.initialize,
                        (
                            address(this),
                            address(this),
                            launchpadRegistry,
                            configManager,
                            dbcFactory,
                            feeController,
                            revenueSplitter,
                            feeCollector
                        )
                    )
                )
            )
        );
        dbcFactory.setRole(dbcFactory.LAUNCHPAD_FACTORY_ROLE(), address(tokenFactory), true);
        feeController.setRole(feeController.FACTORY_ROLE(), address(tokenFactory), true);
        revenueSplitter.setRole(revenueSplitter.FACTORY_ROLE(), address(tokenFactory), true);
        revenueSplitter.setRole(
            revenueSplitter.ACCRUAL_ROLE(), address(feeCollector), true
        );
        feeCollector.setRole(feeCollector.FACTORY_ROLE(), address(tokenFactory), true);
    }

    function testRotatesBoundVirtualPoolDeployerForFutureLaunches() external {
        address previous = address(dbcFactory.poolDeployer());
        VirtualPoolDeployer replacement = new VirtualPoolDeployer(address(this));
        replacement.bindFactory(address(dbcFactory));

        dbcFactory.setPoolDeployer(replacement);

        require(address(dbcFactory.poolDeployer()) == address(replacement), "replacement missing");
        require(address(dbcFactory.poolDeployer()) != previous, "deployer unchanged");
        require(replacement.factory() == address(dbcFactory), "replacement not bound");
    }

    function testCreatesTokenPoolAndImmutableSnapshotsAtomically() external {
        (bytes32 launchId, address token, address pool, bytes32 feeSnapshotId) =
            tokenFactory.createLaunch(_request(bytes32(uint256(1))));
        LaunchpadTokenFactory.LaunchBinding memory item = tokenFactory.binding(launchId);
        LaunchpadConfigManager.Preset memory preset = configManager.preset(presetId);

        require(item.launchpadId == launchpadId, "launchpad binding");
        require(item.configPresetId == presetId, "preset binding");
        require(item.configHash == preset.configHash, "config snapshot");
        require(item.feeSnapshotId == feeSnapshotId, "fee snapshot");
        require(item.creator == address(this), "creator");
        require(item.treasury == address(0x7007), "treasury");
        require(item.token == token && item.virtualPool == pool, "assets");
        require(tokenFactory.launchByToken(token) == launchId, "token reverse binding");
        require(tokenFactory.launchByPool(pool) == launchId, "pool reverse binding");
        require(feeController.snapshot(feeSnapshotId).pool == pool, "pool fee snapshot");
        require(revenueSplitter.snapshot(feeSnapshotId).pool == pool, "splitter snapshot");
        require(VirtualPool(pool).creator() == address(this), "dbc creator");
        require(VirtualPool(pool).feeCollector() == address(feeCollector), "fee collector");
        require(tokenFactory.launchCountByLaunchpad(launchpadId) == 1, "launch count");
    }

    function testRoutesExecutedTradeFeesIntoSnapshottedRevenue() external {
        (, address token, address poolAddress, bytes32 feeSnapshotId) =
            tokenFactory.createLaunch(_request(bytes32(uint256(3))));
        VirtualPool pool = VirtualPool(poolAddress);
        uint256 grossQuote = 0.1e18;
        VirtualPool.BuyQuote memory quote = pool.quoteBuyExactInput(grossQuote);
        usdg.mint(address(this), grossQuote);
        usdg.approve(poolAddress, grossQuote);
        pool.buyExactInput(
            grossQuote, quote.baseOutRaw, quote.finalPriceX18, address(this), block.timestamp
        );

        uint256 collected = feeCollector.collectTradeFees(pool);
        require(collected == quote.feeRaw, "collected fee");
        require(
            revenueSplitter.accruedByKind(
                feeSnapshotId, RevenueSplitter.RevenueKind.TRADE_FEE
            ) == quote.feeRaw,
            "splitter accrual"
        );
        (,, uint128 creatorFee, uint128 partnerFee, uint128 protocolFee,,) =
            pool.accounting();
        require(
            creatorFee == 0 && partnerFee == 0 && protocolFee == 0,
            "pool fee liabilities"
        );
        require(revenueSplitter.totalLiability(address(usdg)) == quote.feeRaw, "liability");
        require(revenueSplitter.isSolvent(address(usdg)), "splitter insolvency");
        require(token != address(0), "token");
    }

    function testLaunchpadPoolPreservesQuotesExecutionGuardsAndSellFlow() external {
        (, address tokenAddress, address poolAddress, bytes32 feeSnapshotId) =
            tokenFactory.createLaunch(_request(bytes32(uint256(4))));
        VirtualPool pool = VirtualPool(poolAddress);
        VirtualPool.BuyQuote memory buyQuote = pool.quoteBuyExactOutput(2e18);
        usdg.mint(address(this), buyQuote.grossQuoteConsumedRaw);
        usdg.approve(poolAddress, buyQuote.grossQuoteConsumedRaw);

        (bool staleDeadline,) = address(pool).call(
            abi.encodeCall(
                VirtualPool.buyExactOutput,
                (2e18, buyQuote.grossQuoteConsumedRaw, buyQuote.finalPriceX18, address(this), 0)
            )
        );
        require(!staleDeadline, "expired deadline accepted");
        (bool invalidPrice,) = address(pool).call(
            abi.encodeCall(
                VirtualPool.buyExactOutput,
                (
                    2e18,
                    buyQuote.grossQuoteConsumedRaw,
                    buyQuote.finalPriceX18 - 1,
                    address(this),
                    block.timestamp
                )
            )
        );
        require(!invalidPrice, "price impact bound bypassed");

        pool.buyExactOutput(
            2e18,
            buyQuote.grossQuoteConsumedRaw,
            buyQuote.finalPriceX18,
            address(this),
            block.timestamp
        );
        require(IERC20Minimal(tokenAddress).balanceOf(address(this)) == 202e18, "buy output");

        IERC20Minimal(tokenAddress).approve(poolAddress, 1e18);
        VirtualPool.SellQuote memory sellQuote = pool.quoteSellExactInput(1e18);
        pool.sellExactInput(
            1e18,
            sellQuote.netQuoteOutRaw,
            sellQuote.finalPriceX18,
            address(this),
            block.timestamp
        );
        uint256 totalFees = buyQuote.feeRaw + sellQuote.feeRaw;
        require(feeCollector.collectTradeFees(pool) == totalFees, "combined fee collection");
        require(
            revenueSplitter.accruedByKind(
                feeSnapshotId, RevenueSplitter.RevenueKind.TRADE_FEE
            ) == totalFees,
            "combined fee accrual"
        );
    }

    function testLegacyLaunchPathRemainsAvailable() external {
        LaunchFactory.LaunchRequest memory request = _dbcRequest(bytes32(uint256(70)));
        (bytes32 launchId,, address pool) = dbcFactory.createLaunch(request);
        (address creator,,,) = dbcFactory.launches(launchId);
        require(creator == address(this), "legacy creator");
        require(VirtualPool(pool).creator() == address(this), "legacy pool creator");
    }

    function testRejectsTemplateMismatchWithoutPartialLaunch() external {
        LaunchpadTokenFactory.LaunchpadLaunchRequest memory request =
            _request(bytes32(uint256(2)));
        request.dbc.templateId = templateId + 1;
        (bool success,) =
            address(tokenFactory).call(abi.encodeCall(LaunchpadTokenFactory.createLaunch, (request)));
        require(!success, "template mismatch accepted");
        require(dbcFactory.launchCount() == 0, "partial dbc launch");
        require(tokenFactory.launchCountByLaunchpad(launchpadId) == 0, "partial binding");
    }

    function testEnforcesPerLaunchpadCapacity() external {
        tokenFactory.createLaunch(_request(bytes32(uint256(10))));
        tokenFactory.createLaunch(_request(bytes32(uint256(11))));
        (bool third,) = address(tokenFactory).call(
            abi.encodeCall(
                LaunchpadTokenFactory.createLaunch, (_request(bytes32(uint256(12))))
            )
        );
        require(!third, "capacity bypassed");
        require(dbcFactory.launchCount() == 2, "unexpected dbc launch");
    }

    function testPermissionPolicySupportsOwnerOnlyAndPermissionlessCreators() external {
        PermissionlessLaunchCreator creator = new PermissionlessLaunchCreator();
        require(
            !creator.tryCreate(tokenFactory, _request(bytes32(uint256(20)))),
            "owner-only policy bypassed"
        );

        uint256 permissionlessPreset = configManager.createPreset(
            LaunchpadConfigManager.PresetInput({
                familyId: keccak256("USDG_DAMM_PERMISSIONLESS"),
                dbcTemplateId: templateId,
                quoteToken: address(usdg),
                maximumTotalTradeFeeBps: 100,
                graduationDestination: LaunchpadConfigManager.GraduationDestination.DAMM,
                creatorAccess: LaunchpadConfigManager.CreatorAccess.PERMISSIONLESS,
                maximumLaunches: 10
            })
        );
        uint256 permissionlessLaunchpad = launchpadRegistry.registerLaunchpad(
            address(this),
            address(0x7010),
            keccak256("permissionless metadata"),
            keccak256("permissionless-launchpad"),
            permissionlessPreset
        );
        feeController.setLaunchpadFeePolicy(
            permissionlessLaunchpad,
            100,
            LaunchpadFeeController.FeeShares({
                protocolShareBps: 4_000,
                operatorShareBps: 2_000,
                creatorShareBps: 4_000,
                referralShareBps: 0
            }),
            address(0x8010)
        );
        LaunchpadTokenFactory.LaunchpadLaunchRequest memory request =
            _request(bytes32(uint256(21)));
        request.launchpadId = permissionlessLaunchpad;
        bytes32 launchId = creator.create(tokenFactory, request);
        require(tokenFactory.binding(launchId).creator == address(creator), "creator binding");
    }

    function testTwoLaunchpadsTradeAndAccrueInIsolatedSnapshots() external {
        uint256 secondLaunchpad = launchpadRegistry.registerLaunchpad(
            address(this),
            address(0x7020),
            keccak256("second launchpad metadata"),
            keccak256("second-isolated-launchpad"),
            presetId
        );
        feeController.setLaunchpadFeePolicy(
            secondLaunchpad,
            100,
            LaunchpadFeeController.FeeShares({
                protocolShareBps: 4_000,
                operatorShareBps: 2_000,
                creatorShareBps: 4_000,
                referralShareBps: 0
            }),
            address(0x8020)
        );
        LaunchpadTokenFactory.LaunchpadLaunchRequest memory firstRequest =
            _request(bytes32(uint256(30)));
        LaunchpadTokenFactory.LaunchpadLaunchRequest memory secondRequest =
            _request(bytes32(uint256(31)));
        secondRequest.launchpadId = secondLaunchpad;
        (bytes32 firstId,, address firstPool, bytes32 firstSnapshot) =
            tokenFactory.createLaunch(firstRequest);
        (bytes32 secondId,, address secondPool, bytes32 secondSnapshot) =
            tokenFactory.createLaunch(secondRequest);

        _buyAndCollect(VirtualPool(firstPool), 0.01e18);
        _buyAndCollect(VirtualPool(secondPool), 0.02e18);

        require(firstId != secondId && firstSnapshot != secondSnapshot, "identity collision");
        require(
            tokenFactory.binding(firstId).launchpadId == launchpadId,
            "first launchpad changed"
        );
        require(
            tokenFactory.binding(secondId).launchpadId == secondLaunchpad,
            "second launchpad changed"
        );
        require(
            revenueSplitter.accruedByKind(
                firstSnapshot, RevenueSplitter.RevenueKind.TRADE_FEE
            ) == 0.0001e18,
            "first revenue"
        );
        require(
            revenueSplitter.accruedByKind(
                secondSnapshot, RevenueSplitter.RevenueKind.TRADE_FEE
            ) == 0.0002e18,
            "second revenue"
        );
    }

    function testLaunchpadQuoterReturnsAttributionAndConservedFeeSplit() external {
        (bytes32 launchId,, address pool, bytes32 snapshotId) =
            tokenFactory.createLaunch(_request(bytes32(uint256(40))));
        CurveQuoter.LaunchpadQuote memory quote = new CurveQuoter().quoteLaunchpad(
            tokenFactory, feeController, launchId, true, 0.01e18
        );
        require(quote.launchId == launchId, "launch attribution");
        require(quote.launchpadId == launchpadId, "launchpad attribution");
        require(quote.feeSnapshotId == snapshotId, "snapshot attribution");
        require(quote.pool == pool && quote.isBuy, "pool attribution");
        require(quote.amountInRaw == 0.01e18 && quote.amountOutRaw > 0, "quote amounts");
        require(
            quote.protocolFeeRaw + quote.operatorFeeRaw + quote.creatorFeeRaw
                    + quote.referralFeeRaw
                == quote.feeRaw,
            "fee split conservation"
        );
    }

    function _request(bytes32 salt)
        private
        view
        returns (LaunchpadTokenFactory.LaunchpadLaunchRequest memory)
    {
        return LaunchpadTokenFactory.LaunchpadLaunchRequest({
            launchpadId: launchpadId,
            dbc: _dbcRequest(salt),
            referralRecipient: address(0)
        });
    }

    function _buyAndCollect(VirtualPool pool, uint256 grossQuote) private {
        VirtualPool.BuyQuote memory quote = pool.quoteBuyExactInput(grossQuote);
        usdg.mint(address(this), grossQuote);
        usdg.approve(address(pool), grossQuote);
        pool.buyExactInput(
            grossQuote, quote.baseOutRaw, quote.finalPriceX18, address(this), block.timestamp
        );
        feeCollector.collectTradeFees(pool);
    }

    function _dbcRequest(bytes32 salt)
        private
        view
        returns (LaunchFactory.LaunchRequest memory)
    {
        return LaunchFactory.LaunchRequest({
            templateId: templateId,
            salt: salt,
            name: "Bound Launch",
            symbol: "BOUND",
            metadataURI: "ipfs://bound-launch",
            creatorTokenRecipient: address(this)
        });
    }

    function _dbcConfig() private view returns (DbcTypes.TemplateConfig memory config) {
        config.quoteToken = address(usdg);
        config.protocolFeeRecipient = address(0x9009);
        config.partnerFeeRecipient = address(0x8008);
        config.protocolLpRecipient = address(0x9009);
        config.quoteDecimals = 18;
        config.baseDecimals = 18;
        config.migrationMode = DbcTypes.MigrationMode.DAMM;
        config.destinationFeePips = 3_000;
        config.terminalPriceToleranceBps = 100;
        config.totalSupplyRaw = 1_000e18;
        config.baseInventoryRaw = 800e18;
        config.graduationThresholdRaw = 1e18;
        config.minimumDestinationShares = 1;
        config.curve.segmentCount = 1;
        config.curve.segments[0] = DbcTypes.LinearSegment({
            initialPriceX18: 0.001e18,
            slopeX18: 0.000001e18,
            saleCapacityX18: 800e18
        });
        config.fees = DbcTypes.FeePolicy({
            tradeFeeBps: 100,
            creatorShareBps: 4_000,
            partnerShareBps: 2_000,
            protocolShareBps: 4_000
        });
        config.lp = DbcTypes.LpPolicy({
            creatorShareBps: 5_000,
            protocolShareBps: 5_000,
            creatorLockSeconds: 1 days
        });
    }
}

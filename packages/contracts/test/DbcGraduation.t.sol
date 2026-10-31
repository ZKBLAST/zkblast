// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DammPool } from "../src/core/DammPool.sol";
import { PoolFactory } from "../src/core/PoolFactory.sol";
import { PoolRegistry } from "../src/core/PoolRegistry.sol";
import { DammGraduationAdapter } from "../src/dbc/DammGraduationAdapter.sol";
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
    uint8 public constant decimals = 6;
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
        usdg = new GraduationUsdg();
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

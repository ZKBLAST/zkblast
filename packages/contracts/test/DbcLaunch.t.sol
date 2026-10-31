// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DbcTypes } from "../src/dbc/DbcTypes.sol";
import { CurveQuoter } from "../src/dbc/CurveQuoter.sol";
import { LaunchConfigRegistry } from "../src/dbc/LaunchConfigRegistry.sol";
import { LaunchFactory } from "../src/dbc/LaunchFactory.sol";
import { LaunchTokenDeployer } from "../src/dbc/LaunchTokenDeployer.sol";
import { VirtualPoolDeployer } from "../src/dbc/VirtualPoolDeployer.sol";
import { LaunchpadRouter } from "../src/dbc/LaunchpadRouter.sol";
import { LaunchToken } from "../src/dbc/LaunchToken.sol";
import { VirtualPool } from "../src/dbc/VirtualPool.sol";
import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";

contract MockUsdgMetadata {
    uint8 public constant decimals = 6;
    string public constant name = "Global Dollar";
    string public constant symbol = "USDG";
    uint256 public totalSupply;
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    function mint(address recipient, uint256 amount) external {
        totalSupply += amount;
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
        uint256 available = allowance[sender][msg.sender];
        if (available != type(uint256).max) allowance[sender][msg.sender] = available - amount;
        balanceOf[sender] -= amount;
        balanceOf[recipient] += amount;
        return true;
    }
}

contract DbcLaunchTest {
    LaunchConfigRegistry private registry;
    LaunchFactory private factory;
    LaunchpadRouter private router;
    CurveQuoter private quoter;
    MockUsdgMetadata private usdg;
    uint256 private templateId;

    function setUp() public {
        usdg = new MockUsdgMetadata();
        LaunchConfigRegistry registryImplementation = new LaunchConfigRegistry();
        registry = LaunchConfigRegistry(
            address(
                new ERC1967Proxy(
                    address(registryImplementation),
                    abi.encodeCall(
                        LaunchConfigRegistry.initialize,
                        (address(this), address(this), address(this))
                    )
                )
            )
        );
        registry.setQuoteToken(address(usdg), true);
        templateId = registry.createTemplate(keccak256("USDG_LINEAR"), _config());
        LaunchTokenDeployer tokenDeployer = new LaunchTokenDeployer(address(this));
        VirtualPoolDeployer poolDeployer = new VirtualPoolDeployer(address(this));
        LaunchFactory factoryImplementation = new LaunchFactory();
        factory = LaunchFactory(
            address(
                new ERC1967Proxy(
                    address(factoryImplementation),
                    abi.encodeCall(
                        LaunchFactory.initialize,
                        (address(this), address(this), registry, tokenDeployer, poolDeployer)
                    )
                )
            )
        );
        tokenDeployer.bindFactory(address(factory));
        poolDeployer.bindFactory(address(factory));
        registry.setRole(registry.FACTORY_ROLE(), address(factory), true);
        LaunchpadRouter routerImplementation = new LaunchpadRouter();
        router = LaunchpadRouter(
            address(
                new ERC1967Proxy(
                    address(routerImplementation),
                    abi.encodeCall(
                        LaunchpadRouter.initialize, (address(this), address(this), factory)
                    )
                )
            )
        );
        quoter = new CurveQuoter();
        usdg.mint(address(this), 10_000_000);
    }

    function testCreatesCanonicalTokenAndEscrowsExactInventory() external {
        (bytes32 launchId, address tokenAddress, address poolAddress) =
            factory.createLaunch(_request(bytes32(uint256(1))));
        LaunchToken token = LaunchToken(tokenAddress);
        VirtualPool pool = VirtualPool(poolAddress);
        require(token.totalSupply() == 1_000e18, "total supply");
        require(token.balanceOf(poolAddress) == 100e18, "escrow inventory");
        require(token.balanceOf(address(this)) == 900e18, "creator allocation");
        require(pool.lifecycle() == DbcTypes.Lifecycle.ACTIVE, "pool inactive");
        require(pool.creator() == address(this), "creator");
        require(pool.quoteToken() == address(usdg), "quote token");
        require(factory.launchByToken(tokenAddress) == launchId, "token mapping");
        require(factory.launchByPool(poolAddress) == launchId, "pool mapping");
        require(registry.template(templateId).used, "template use marker");
    }

    function testTemplateIsReusableAndSaltIsUnique() external {
        (bytes32 firstId, address firstToken,) = factory.createLaunch(_request(bytes32(uint256(1))));
        (bytes32 secondId, address secondToken,) =
            factory.createLaunch(_request(bytes32(uint256(2))));
        require(firstId != secondId, "launch id collision");
        require(firstToken != secondToken, "token collision");
        require(factory.launchCount() == 2, "launch count");
    }

    function testRejectsDuplicateLaunchAndDisabledTemplate() external {
        LaunchFactory.LaunchRequest memory request = _request(bytes32(uint256(1)));
        factory.createLaunch(request);
        (bool duplicateSuccess,) =
            address(factory).call(abi.encodeCall(LaunchFactory.createLaunch, (request)));
        require(!duplicateSuccess, "duplicate launch accepted");
        registry.setTemplateEnabled(templateId, false);
        request.salt = bytes32(uint256(2));
        (bool disabledSuccess,) =
            address(factory).call(abi.encodeCall(LaunchFactory.createLaunch, (request)));
        require(!disabledSuccess, "disabled template accepted");
    }

    function testBuySellFeesAndClaimRemainSolvent() external {
        (, address tokenAddress, address poolAddress) =
            factory.createLaunch(_request(bytes32(uint256(11))));
        LaunchToken token = LaunchToken(tokenAddress);
        VirtualPool pool = VirtualPool(poolAddress);
        usdg.approve(poolAddress, type(uint256).max);

        VirtualPool.BuyQuote memory buyQuote = pool.quoteBuyExactInput(505_050);
        uint256 quoteBalanceBefore = usdg.balanceOf(address(this));
        pool.buyExactInput(
            505_050, buyQuote.baseOutRaw, buyQuote.finalPriceX18, address(this), block.timestamp
        );
        require(
            quoteBalanceBefore - usdg.balanceOf(address(this)) == buyQuote.grossQuoteConsumedRaw,
            "buy quote debit"
        );
        _assertBuyAccounting(pool, buyQuote);

        uint256 baseToSell = buyQuote.baseOutRaw / 2;
        token.approve(poolAddress, baseToSell);
        VirtualPool.SellQuote memory sellQuote = pool.quoteSellExactInput(baseToSell);
        uint256 usdgBeforeSell = usdg.balanceOf(address(this));
        pool.sellExactInput(
            baseToSell,
            sellQuote.netQuoteOutRaw,
            sellQuote.finalPriceX18,
            address(this),
            block.timestamp
        );
        require(
            usdg.balanceOf(address(this)) - usdgBeforeSell == sellQuote.netQuoteOutRaw,
            "sell payout"
        );

        uint256 beforeClaim = usdg.balanceOf(address(this));
        pool.claimFees(0);
        require(usdg.balanceOf(address(this)) > beforeClaim, "creator claim");
        require(usdg.balanceOf(poolAddress) >= _totalLiabilities(pool), "solvency");
    }

    function testThresholdCapsInputAndFreezesTrading() external {
        (, address tokenAddress, address poolAddress) =
            factory.createLaunch(_request(bytes32(uint256(12))));
        VirtualPool pool = VirtualPool(poolAddress);
        usdg.approve(poolAddress, type(uint256).max);
        uint256 beforeBalance = usdg.balanceOf(address(this));
        uint256 baseBefore = LaunchToken(tokenAddress).balanceOf(address(this));
        VirtualPool.BuyQuote memory quote = pool.quoteBuyExactInput(2_000_000);
        pool.buyExactInput(
            2_000_000, quote.baseOutRaw, quote.finalPriceX18, address(this), block.timestamp
        );
        require(quote.grossQuoteConsumedRaw < 2_000_000, "input not capped");
        require(
            beforeBalance - usdg.balanceOf(address(this)) == quote.grossQuoteConsumedRaw,
            "excess input pulled"
        );
        (, uint128 reserve,,,,,) = pool.accounting();
        require(reserve == 1_000_000, "threshold reserve");
        require(pool.lifecycle() == DbcTypes.Lifecycle.GRADUATION_READY, "not ready");
        require(
            LaunchToken(tokenAddress).balanceOf(address(this)) - baseBefore == quote.baseOutRaw,
            "base out"
        );
        (bool secondBuySuccess,) = address(pool)
            .call(
                abi.encodeCall(VirtualPool.buyExactInput, (1, 0, 0, address(this), block.timestamp))
            );
        require(!secondBuySuccess, "trading after threshold");
    }

    function testPauseAndSlippageProtection() external {
        (, address tokenAddress, address poolAddress) =
            factory.createLaunch(_request(bytes32(uint256(13))));
        VirtualPool pool = VirtualPool(poolAddress);
        usdg.approve(poolAddress, type(uint256).max);
        uint256 baseBefore = LaunchToken(tokenAddress).balanceOf(address(this));
        VirtualPool.BuyQuote memory quote = pool.quoteBuyExactInput(100_000);
        (bool slippageSuccess,) = address(pool)
            .call(
                abi.encodeCall(
                    VirtualPool.buyExactInput,
                    (
                        100_000,
                        quote.baseOutRaw + 1,
                        quote.finalPriceX18,
                        address(this),
                        block.timestamp
                    )
                )
            );
        require(!slippageSuccess, "slippage bypass");
        factory.setPoolPaused(pool, true);
        require(pool.lifecycle() == DbcTypes.Lifecycle.PAUSED, "pause failed");
        require(
            LaunchToken(tokenAddress).balanceOf(address(this)) == baseBefore, "unexpected transfer"
        );
    }

    function testRouterAndQuoterMatchExecutionWithoutCustody() external {
        (, address tokenAddress, address poolAddress) =
            factory.createLaunch(_request(bytes32(uint256(14))));
        LaunchToken token = LaunchToken(tokenAddress);
        VirtualPool pool = VirtualPool(poolAddress);
        usdg.approve(address(router), type(uint256).max);

        VirtualPool.BuyQuote memory quote = quoter.quoteBuy(pool, 250_000);
        uint256 baseBefore = token.balanceOf(address(this));
        VirtualPool.BuyQuote memory executed = router.buyExactInput(
            pool, 250_000, quote.baseOutRaw, quote.finalPriceX18, address(this), block.timestamp
        );
        require(executed.baseOutRaw == quote.baseOutRaw, "router buy mismatch");
        require(token.balanceOf(address(this)) - baseBefore == quote.baseOutRaw, "router base out");
        require(usdg.balanceOf(address(router)) == 0, "router retained quote");
        require(token.balanceOf(address(router)) == 0, "router retained base");

        token.approve(address(router), executed.baseOutRaw);
        VirtualPool.SellQuote memory sellQuote = quoter.quoteSell(pool, executed.baseOutRaw);
        VirtualPool.SellQuote memory sold = router.sellExactInput(
            pool,
            executed.baseOutRaw,
            sellQuote.netQuoteOutRaw,
            sellQuote.finalPriceX18,
            address(this),
            block.timestamp
        );
        require(sold.netQuoteOutRaw == sellQuote.netQuoteOutRaw, "router sell mismatch");
        require(usdg.balanceOf(address(router)) == 0, "router quote residue");
        require(token.balanceOf(address(router)) == 0, "router base residue");
    }

    function testExactOutputHonorsMaximumInputs() external {
        (, address tokenAddress, address poolAddress) =
            factory.createLaunch(_request(bytes32(uint256(15))));
        LaunchToken token = LaunchToken(tokenAddress);
        VirtualPool pool = VirtualPool(poolAddress);
        usdg.approve(address(router), type(uint256).max);

        VirtualPool.BuyQuote memory buyQuote = quoter.quoteBuyExactOutput(pool, 10e18);
        uint256 baseBefore = token.balanceOf(address(this));
        router.buyExactOutput(
            pool,
            10e18,
            buyQuote.grossQuoteConsumedRaw,
            buyQuote.finalPriceX18,
            address(this),
            block.timestamp
        );
        require(token.balanceOf(address(this)) - baseBefore == 10e18, "exact base output");

        VirtualPool.SellQuote memory sellQuote = quoter.quoteSellExactOutput(pool, 50_000);
        token.approve(address(router), sellQuote.baseInRaw);
        uint256 quoteBefore = usdg.balanceOf(address(this));
        router.sellExactOutput(
            pool,
            50_000,
            sellQuote.baseInRaw,
            sellQuote.finalPriceX18,
            address(this),
            block.timestamp
        );
        require(usdg.balanceOf(address(this)) - quoteBefore >= 50_000, "exact quote output");
        require(usdg.balanceOf(address(router)) == 0, "exact-output quote residue");
        require(token.balanceOf(address(router)) == 0, "exact-output base residue");
    }

    function _totalLiabilities(VirtualPool pool) private view returns (uint256 total) {
        (
            ,
            uint128 reserve,
            uint128 creatorFees,
            uint128 partnerFees,
            uint128 protocolFees,
            uint128 baseDust,
            uint128 quoteDust
        ) = pool.accounting();
        baseDust;
        total = uint256(reserve) + creatorFees + partnerFees + protocolFees + quoteDust;
    }

    function _assertBuyAccounting(VirtualPool pool, VirtualPool.BuyQuote memory quote)
        private
        view
    {
        (
            uint128 baseSold,
            uint128 reserve,
            uint128 creatorFees,
            uint128 partnerFees,
            uint128 protocolFees,,
        ) = pool.accounting();
        require(baseSold == quote.baseOutRaw, "base sold");
        require(reserve == quote.netQuoteRaw, "real reserve");
        require(
            uint256(creatorFees) + partnerFees + protocolFees == quote.feeRaw, "fee liabilities"
        );
    }

    function _request(bytes32 salt)
        private
        view
        returns (LaunchFactory.LaunchRequest memory request)
    {
        request = LaunchFactory.LaunchRequest({
            templateId: templateId,
            salt: salt,
            name: "ZKBLAST Launch",
            symbol: "ZKL",
            metadataURI: "ipfs://zkblast-launch",
            creatorTokenRecipient: address(this)
        });
    }

    function _config() private view returns (DbcTypes.TemplateConfig memory config) {
        config.quoteToken = address(usdg);
        config.protocolFeeRecipient = address(0x1001);
        config.partnerFeeRecipient = address(0x1002);
        config.protocolLpRecipient = address(0x1003);
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

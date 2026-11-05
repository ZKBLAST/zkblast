// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DbcTypes } from "../src/dbc/DbcTypes.sol";
import { LaunchConfigRegistry } from "../src/dbc/LaunchConfigRegistry.sol";
import { ProtectedVirtualPool } from "../src/dbc/ProtectedVirtualPool.sol";
import {
    LaunchProtectionPolicyRegistry
} from "../src/launchpad/protection/LaunchProtectionPolicyRegistry.sol";
import { ProtectedLaunchFactory } from "../src/launchpad/protection/ProtectedLaunchFactory.sol";
import { ProtectedLaunchToken } from "../src/launchpad/protection/ProtectedLaunchToken.sol";
import { ProtectedLaunchRouter } from "../src/launchpad/protection/ProtectedLaunchRouter.sol";
import {
    ProtectedLaunchIdentityRegistry
} from "../src/launchpad/protection/ProtectedLaunchIdentityRegistry.sol";
import {
    ProtectedLaunchTokenDeployer
} from "../src/launchpad/protection/ProtectedLaunchTokenDeployer.sol";
import {
    ProtectedVirtualPoolDeployer
} from "../src/launchpad/protection/ProtectedVirtualPoolDeployer.sol";
import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";

contract MockProtectedQuoteToken {
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;
    bool public feeEnabled;

    function setFeeEnabled(bool enabled) external {
        feeEnabled = enabled;
    }

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
        balanceOf[recipient] += feeEnabled && amount != 0 ? amount - 1 : amount;
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount)
        external
        returns (bool)
    {
        uint256 available = allowance[sender][msg.sender];
        if (available != type(uint256).max) allowance[sender][msg.sender] = available - amount;
        balanceOf[sender] -= amount;
        balanceOf[recipient] += feeEnabled && amount != 0 ? amount - 1 : amount;
        return true;
    }
}

contract ProtectedBuyerActor {
    function approveQuote(MockProtectedQuoteToken quote, address spender) external {
        quote.approve(spender, type(uint256).max);
    }

    function buyExactOutputViaRouter(
        ProtectedLaunchRouter router,
        ProtectedVirtualPool pool,
        uint256 baseAmount,
        address recipient
    ) external returns (bool success) {
        (success,) = address(router)
            .call(
                abi.encodeCall(
                    ProtectedLaunchRouter.buyExactOutput,
                    (pool, baseAmount, type(uint256).max, 0, recipient, block.timestamp)
                )
            );
    }

    function bundleBuys(
        ProtectedLaunchRouter router,
        ProtectedVirtualPool pool,
        uint256 baseAmount,
        address recipient,
        uint256 attempts
    ) external returns (uint256 successes) {
        for (uint256 index; index < attempts; ++index) {
            (bool success,) = address(router)
                .call(
                    abi.encodeCall(
                        ProtectedLaunchRouter.buyExactOutput,
                        (pool, baseAmount, type(uint256).max, 0, recipient, block.timestamp)
                    )
                );
            if (success) ++successes;
        }
    }
}

contract MockStockExecutionGuard {
    bool public createEnabled = true;
    bool public buyEnabled;
    bool public sellEnabled = true;

    function setBuyEnabled(bool enabled) external {
        buyEnabled = enabled;
    }

    bytes32 public constant POLICY_IDENTITY = keccak256("STOCK_POLICY");

    function validateCreate(address) external view returns (bytes32) {
        require(createEnabled, "create disabled");
        return POLICY_IDENTITY;
    }

    function validateBuy(address, uint256) external view returns (bytes32) {
        require(buyEnabled, "buy disabled");
        return POLICY_IDENTITY;
    }

    function validateSell(address) external view returns (bytes32) {
        require(sellEnabled, "sell disabled");
        return POLICY_IDENTITY;
    }

    function validateGraduate(address, uint256) external view returns (bytes32) {
        require(sellEnabled, "graduation disabled");
        return POLICY_IDENTITY;
    }

    function policyIdentity(address) external pure returns (bytes32) {
        return POLICY_IDENTITY;
    }
}

contract ProtectedLaunchFactoryTest {
    MockProtectedQuoteToken private quote;
    LaunchConfigRegistry private templateRegistry;
    LaunchProtectionPolicyRegistry private policyRegistry;
    ProtectedLaunchFactory private factory;
    ProtectedLaunchIdentityRegistry private identityRegistry;
    uint256 private templateId;
    uint256 private policyId;

    function setUp() public {
        quote = new MockProtectedQuoteToken();
        templateRegistry = LaunchConfigRegistry(
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
        policyRegistry = LaunchProtectionPolicyRegistry(
            address(
                new ERC1967Proxy(
                    address(new LaunchProtectionPolicyRegistry()),
                    abi.encodeCall(
                        LaunchProtectionPolicyRegistry.initialize,
                        (address(this), address(this), address(this))
                    )
                )
            )
        );
        templateRegistry.setQuoteToken(address(quote), true);
        templateId = templateRegistry.createTemplate(keccak256("PROTECTED_LINEAR"), _config());
        policyId = policyRegistry.createPolicy(_policy());

        ProtectedLaunchTokenDeployer tokenDeployer = new ProtectedLaunchTokenDeployer(address(this));
        ProtectedVirtualPoolDeployer poolDeployer = new ProtectedVirtualPoolDeployer(address(this));
        factory = ProtectedLaunchFactory(
            address(new ERC1967Proxy(address(new ProtectedLaunchFactory()), bytes("")))
        );
        identityRegistry = ProtectedLaunchIdentityRegistry(
            address(
                new ERC1967Proxy(
                    address(new ProtectedLaunchIdentityRegistry()),
                    abi.encodeCall(
                        ProtectedLaunchIdentityRegistry.initialize,
                        (address(this), address(this), address(factory))
                    )
                )
            )
        );
        factory.initialize(
            address(this),
            address(this),
            templateRegistry,
            policyRegistry,
            tokenDeployer,
            poolDeployer,
            identityRegistry
        );
        tokenDeployer.bindFactory(address(factory));
        poolDeployer.bindFactory(address(factory));
        templateRegistry.setRole(templateRegistry.FACTORY_ROLE(), address(factory), true);
        policyRegistry.setRole(policyRegistry.POLICY_CONSUMER_ROLE(), address(factory), true);
        quote.mint(address(this), 10_000_000);
    }

    function testCreatesAtomicallyBoundProtectedLaunch() external {
        (bytes32 launchId, address tokenAddress, address poolAddress) =
            factory.createLaunch(_request(bytes32(uint256(1))));
        ProtectedLaunchToken token = ProtectedLaunchToken(tokenAddress);
        ProtectedVirtualPool pool = ProtectedVirtualPool(poolAddress);
        (
            address creator,
            address recordedToken,
            address recordedPool,
            uint256 recordedTemplate,
            uint256 recordedPolicy,
            bytes32 policyHash,
            uint64 startBlock
        ) = factory.launches(launchId);

        require(creator == address(this), "creator");
        require(recordedToken == tokenAddress && recordedPool == poolAddress, "binding");
        require(recordedTemplate == templateId && recordedPolicy == policyId, "ids");
        require(policyHash == token.policyHash(), "policy hash");
        require(startBlock == block.number, "start block");
        require(token.protectedPool() == poolAddress, "protected pool");
        require(token.launchStartBlock() == startBlock, "token start");
        require(pool.lifecycle() == DbcTypes.Lifecycle.ACTIVE, "pool inactive");
        require(token.balanceOf(poolAddress) == 800e18, "inventory");
        require(token.balanceOf(address(this)) == 200e18, "creator allocation");
        require(templateRegistry.template(templateId).used, "template unused");
        require(policyRegistry.policy(policyId).used, "policy unused");
        ProtectedLaunchIdentityRegistry.Identity memory identity =
            identityRegistry.identity(launchId);
        require(identity.token == tokenAddress && identity.pool == poolAddress, "identity binding");
        require(identity.factory == address(factory), "identity factory");
        require(identity.tokenTemplateVersion == token.TEMPLATE_VERSION(), "identity version");
    }

    function testDirectPoolBuyCannotBypassActualOutputCap() external {
        (, address tokenAddress, address poolAddress) =
            factory.createLaunch(_request(bytes32(uint256(2))));
        ProtectedLaunchToken token = ProtectedLaunchToken(tokenAddress);
        ProtectedVirtualPool pool = ProtectedVirtualPool(poolAddress);
        quote.approve(poolAddress, type(uint256).max);

        ProtectedVirtualPool.BuyQuote memory oversized = pool.quoteBuyExactInput(100_000);
        require(oversized.baseOutRaw > token.maximumBuyPerTransaction(), "quote not oversized");
        (bool oversizedSuccess,) = address(pool)
            .call(
                abi.encodeCall(
                    ProtectedVirtualPool.buyExactInput,
                    (100_000, 0, 0, address(this), block.timestamp)
                )
            );
        require(!oversizedSuccess, "direct pool bypass");

        ProtectedVirtualPool.BuyQuote memory valid = pool.quoteBuyExactInput(20_000);
        require(valid.baseOutRaw <= token.maximumBuyPerTransaction(), "quote too large");
        pool.buyExactInput(
            20_000, valid.baseOutRaw, valid.finalPriceX18, address(this), block.timestamp
        );
        require(
            token.purchasedDuringProtection(address(this)) == valid.baseOutRaw,
            "actual output not recorded"
        );
    }

    function testProtectedPoolQuoteSettlementAndFeeAccountingMatch() external {
        (, address tokenAddress, address poolAddress) =
            factory.createLaunch(_request(bytes32(uint256(7))));
        ProtectedLaunchToken token = ProtectedLaunchToken(tokenAddress);
        ProtectedVirtualPool pool = ProtectedVirtualPool(poolAddress);
        quote.approve(poolAddress, type(uint256).max);

        require(pool.currentBuyFeeBps() == 500, "initial fee");
        ProtectedVirtualPool.BuyQuote memory buyQuote = pool.quoteBuyExactInput(20_000);
        uint256 quoteBefore = quote.balanceOf(address(this));
        uint256 tokenBefore = token.balanceOf(address(this));
        pool.buyExactInput(
            20_000, buyQuote.baseOutRaw, buyQuote.finalPriceX18, address(this), block.timestamp
        );
        require(
            quoteBefore - quote.balanceOf(address(this)) == buyQuote.grossQuoteConsumedRaw,
            "gross debit"
        );
        require(token.balanceOf(address(this)) - tokenBefore == buyQuote.baseOutRaw, "base output");
        (
            uint128 baseSold,
            uint128 reserve,
            uint128 creatorFee,
            uint128 partnerFee,
            uint128 protocolFee,,
        ) = pool.accounting();
        require(baseSold == buyQuote.baseOutRaw, "base accounting");
        require(reserve == buyQuote.netQuoteRaw, "reserve accounting");
        require(uint256(creatorFee) + partnerFee + protocolFee == buyQuote.feeRaw, "fee accounting");

        uint256 beforeClaim = quote.balanceOf(address(this));
        pool.claimFees(0);
        require(
            quote.balanceOf(address(this)) - beforeClaim == creatorFee,
            "creator recipient substitution"
        );
        (
            ,
            uint128 reserveAfter,
            uint128 creatorAfter,
            uint128 partnerAfter,
            uint128 protocolAfter,,
        ) = pool.accounting();
        require(creatorAfter == 0, "creator liability retained");
        require(
            quote.balanceOf(poolAddress) == uint256(reserveAfter) + partnerAfter + protocolAfter,
            "principal or liability diverted"
        );

        uint256 sellAmount = buyQuote.baseOutRaw / 2;
        token.approve(poolAddress, sellAmount);
        ProtectedVirtualPool.SellQuote memory sellQuote = pool.quoteSellExactInput(sellAmount);
        require(
            sellQuote.feeRaw == sellQuote.grossQuoteOutRaw * 100 / 10_000,
            "sell fee is not base fee"
        );
    }

    function testRejectsDuplicateAndDisabledPolicyLaunches() external {
        ProtectedLaunchFactory.LaunchRequest memory request = _request(bytes32(uint256(3)));
        factory.createLaunch(request);
        (bool duplicate,) =
            address(factory).call(abi.encodeCall(ProtectedLaunchFactory.createLaunch, (request)));
        require(!duplicate, "duplicate accepted");

        policyRegistry.setPolicyEnabled(policyId, false);
        request.salt = bytes32(uint256(4));
        (bool disabled,) =
            address(factory).call(abi.encodeCall(ProtectedLaunchFactory.createLaunch, (request)));
        require(!disabled, "disabled policy accepted");
    }

    function testRejectsStaleProtectedLaunchRequest() external {
        ProtectedLaunchFactory.LaunchRequest memory request = _request(bytes32(uint256(5)));
        request.deadline = uint64(block.timestamp - 1);
        (bool success,) =
            address(factory).call(abi.encodeCall(ProtectedLaunchFactory.createLaunch, (request)));
        require(!success, "stale request accepted");
    }

    function testRouterAndSmartWalletCannotSplitPastAddressCap() external {
        (, address tokenAddress, address poolAddress) =
            factory.createLaunch(_request(bytes32(uint256(6))));
        ProtectedLaunchToken token = ProtectedLaunchToken(tokenAddress);
        ProtectedVirtualPool pool = ProtectedVirtualPool(poolAddress);
        ProtectedLaunchRouter router = ProtectedLaunchRouter(
            address(
                new ERC1967Proxy(
                    address(new ProtectedLaunchRouter()),
                    abi.encodeCall(
                        ProtectedLaunchRouter.initialize, (address(this), address(this), factory)
                    )
                )
            )
        );
        ProtectedBuyerActor wallet = new ProtectedBuyerActor();
        quote.mint(address(wallet), 100_000_000);
        wallet.approveQuote(quote, address(router));

        uint256 purchase = token.maximumBuyPerTransaction();
        require(
            wallet.buyExactOutputViaRouter(router, pool, purchase, address(wallet)),
            "first routed buy"
        );
        require(
            wallet.buyExactOutputViaRouter(router, pool, purchase, address(wallet)),
            "second routed buy"
        );
        require(
            wallet.buyExactOutputViaRouter(router, pool, purchase, address(wallet)),
            "third routed buy"
        );
        require(
            wallet.buyExactOutputViaRouter(router, pool, purchase, address(wallet)),
            "fourth routed buy"
        );
        require(
            !wallet.buyExactOutputViaRouter(router, pool, purchase, address(wallet)),
            "split-buy cap bypass"
        );
        require(
            token.purchasedDuringProtection(address(wallet)) <= token.maximumBuyPerAddress(),
            "address allocation exceeded"
        );
    }

    function testFirstBlockSameTransactionBundleStopsAtAddressCap() external {
        (, address tokenAddress, address poolAddress) =
            factory.createLaunch(_request(bytes32(uint256(8))));
        ProtectedLaunchToken token = ProtectedLaunchToken(tokenAddress);
        ProtectedVirtualPool pool = ProtectedVirtualPool(poolAddress);
        ProtectedLaunchRouter router = _router();
        ProtectedBuyerActor wallet = new ProtectedBuyerActor();
        quote.mint(address(wallet), 100_000_000);
        wallet.approveQuote(quote, address(router));

        uint256 startBlock = block.number;
        uint256 successes =
            wallet.bundleBuys(router, pool, token.maximumBuyPerTransaction(), address(wallet), 5);
        require(block.number == startBlock, "bundle left launch block");
        require(successes == 4, "unexpected bundled acceptance");
        require(
            token.purchasedDuringProtection(address(wallet)) == token.maximumBuyPerAddress(),
            "bundle accounting"
        );
    }

    function testSplitWalletLimitIsPerRecipientNotGlobalIdentity() external {
        (, address tokenAddress, address poolAddress) =
            factory.createLaunch(_request(bytes32(uint256(9))));
        ProtectedLaunchToken token = ProtectedLaunchToken(tokenAddress);
        ProtectedVirtualPool pool = ProtectedVirtualPool(poolAddress);
        ProtectedLaunchRouter router = _router();
        ProtectedBuyerActor first = new ProtectedBuyerActor();
        ProtectedBuyerActor second = new ProtectedBuyerActor();
        quote.mint(address(first), 100_000_000);
        quote.mint(address(second), 100_000_000);
        first.approveQuote(quote, address(router));
        second.approveQuote(quote, address(router));
        uint256 purchase = token.maximumBuyPerTransaction();

        require(first.bundleBuys(router, pool, purchase, address(first), 4) == 4, "first");
        require(second.bundleBuys(router, pool, purchase, address(second), 4) == 4, "second");
        require(
            token.purchasedDuringProtection(address(first)) == token.maximumBuyPerAddress(),
            "first cap"
        );
        require(
            token.purchasedDuringProtection(address(second)) == token.maximumBuyPerAddress(),
            "second cap"
        );
    }

    function testRejectsFeeOnTransferQuoteTokenSettlement() external {
        (, address tokenAddress, address poolAddress) =
            factory.createLaunch(_request(bytes32(uint256(10))));
        ProtectedLaunchToken token = ProtectedLaunchToken(tokenAddress);
        ProtectedVirtualPool pool = ProtectedVirtualPool(poolAddress);
        ProtectedLaunchRouter router = _router();
        quote.approve(address(router), type(uint256).max);
        quote.setFeeEnabled(true);
        (bool success,) = address(router)
            .call(
                abi.encodeCall(
                    ProtectedLaunchRouter.buyExactOutput,
                    (
                        pool,
                        token.maximumBuyPerTransaction(),
                        type(uint256).max,
                        0,
                        address(this),
                        block.timestamp
                    )
                )
            );
        require(!success, "fee-on-transfer quote accepted");
        require(token.purchasedDuringProtection(address(this)) == 0, "allocation consumed");
    }

    function testStockQuoteGuardCannotBeBypassedByCallingPoolDirectly() external {
        MockStockExecutionGuard guard = new MockStockExecutionGuard();
        templateRegistry.setQuoteTokenProtectedOnly(address(quote), true);
        factory.bindQuoteExecutionGuard(address(quote), address(guard));
        (, address tokenAddress, address poolAddress) =
            factory.createLaunch(_request(bytes32(uint256(11))));
        ProtectedLaunchToken token = ProtectedLaunchToken(tokenAddress);
        ProtectedVirtualPool pool = ProtectedVirtualPool(poolAddress);
        quote.approve(poolAddress, type(uint256).max);

        uint256 baseAmount = token.maximumBuyPerTransaction();
        ProtectedVirtualPool.BuyQuote memory quoted = pool.quoteBuyExactOutput(baseAmount);
        (bool bypassed,) = address(pool)
            .call(
                abi.encodeCall(
                    ProtectedVirtualPool.buyExactOutput,
                    (baseAmount, quoted.grossQuoteConsumedRaw, 0, address(this), block.timestamp)
                )
            );
        require(!bypassed, "direct pool bypassed guard");

        guard.setBuyEnabled(true);
        pool.buyExactOutput(
            baseAmount, quoted.grossQuoteConsumedRaw, 0, address(this), block.timestamp
        );
        require(token.balanceOf(address(this)) == 200e18 + baseAmount, "guarded buy failed");
    }

    function _router() private returns (ProtectedLaunchRouter router) {
        router = ProtectedLaunchRouter(
            address(
                new ERC1967Proxy(
                    address(new ProtectedLaunchRouter()),
                    abi.encodeCall(
                        ProtectedLaunchRouter.initialize, (address(this), address(this), factory)
                    )
                )
            )
        );
    }

    function _request(bytes32 salt)
        private
        view
        returns (ProtectedLaunchFactory.LaunchRequest memory request)
    {
        request = ProtectedLaunchFactory.LaunchRequest({
            templateId: templateId,
            policyId: policyId,
            salt: salt,
            deadline: type(uint64).max,
            name: "Protected Launch",
            symbol: "PLCH",
            metadataURI: "ipfs://protected-launch",
            creatorTokenRecipient: address(this)
        });
    }

    function _policy()
        private
        pure
        returns (LaunchProtectionPolicyRegistry.PolicyInput memory input)
    {
        input = LaunchProtectionPolicyRegistry.PolicyInput({
            familyId: keccak256("PROTECTED_V1"),
            protectionBlocks: 100,
            maxBuyBpsPerTransaction: 25,
            maxBuyBpsPerAddress: 100,
            initialFeeBps: 500,
            baseFeeBps: 100,
            lpLockSeconds: 30 days,
            batchMode: false
        });
    }

    function _config() private view returns (DbcTypes.TemplateConfig memory config) {
        config.quoteToken = address(quote);
        config.protocolFeeRecipient = address(0x1001);
        config.partnerFeeRecipient = address(0x1002);
        config.protocolLpRecipient = address(0x1003);
        config.quoteDecimals = 6;
        config.baseDecimals = 18;
        config.migrationMode = DbcTypes.MigrationMode.DAMM;
        config.destinationFeePips = 3_000;
        config.terminalPriceToleranceBps = 100;
        config.totalSupplyRaw = 1_000e18;
        config.baseInventoryRaw = 800e18;
        config.graduationThresholdRaw = 1_000_000;
        config.minimumDestinationShares = 1;
        config.curve.segmentCount = 1;
        config.curve.segments[0] = DbcTypes.LinearSegment({
            initialPriceX18: 0.01e18, slopeX18: 0.00001e18, saleCapacityX18: 800e18
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

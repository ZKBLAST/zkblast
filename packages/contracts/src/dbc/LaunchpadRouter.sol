// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { TokenTransfer } from "../libraries/TokenTransfer.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { ReentrancyGuard } from "../security/ReentrancyGuard.sol";
import { LaunchFactory } from "./LaunchFactory.sol";
import { VirtualPool } from "./VirtualPool.sol";

contract LaunchpadRouter is ProtocolAccess, UUPSUpgradeable, ReentrancyGuard {
    using TokenTransfer for address;

    error InvalidFactory();
    error InvalidPool();
    error SlippageExceeded();

    LaunchFactory public factory;

    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address upgrader, LaunchFactory factory_)
        external
        initializer
    {
        if (address(factory_) == address(0)) revert InvalidFactory();
        __ProtocolAccess_init(admin, upgrader);
        factory = factory_;
    }

    function buyExactInput(
        VirtualPool pool,
        uint256 grossQuoteInRaw,
        uint256 minimumBaseOutRaw,
        uint256 maximumPriceX18,
        address recipient,
        uint256 deadline
    ) external nonReentrant returns (VirtualPool.BuyQuote memory quote) {
        _validatePool(pool);
        quote = pool.quoteBuyExactInput(grossQuoteInRaw);
        address quoteToken = pool.quoteToken();
        quoteToken.pullExact(msg.sender, quote.grossQuoteConsumedRaw);
        quoteToken.forceApprove(address(pool), quote.grossQuoteConsumedRaw);
        // nonReentrant is active before any token or pool call.
        // forge-lint: disable-next-line(reentrancy-no-eth)
        quote = pool.buyExactInput(
            quote.grossQuoteConsumedRaw, minimumBaseOutRaw, maximumPriceX18, recipient, deadline
        );
        quoteToken.forceApprove(address(pool), 0);
    }

    function sellExactInput(
        VirtualPool pool,
        uint256 baseInRaw,
        uint256 minimumQuoteOutRaw,
        uint256 minimumPriceX18,
        address recipient,
        uint256 deadline
    ) external nonReentrant returns (VirtualPool.SellQuote memory quote) {
        _validatePool(pool);
        address baseToken = pool.baseToken();
        baseToken.pullExact(msg.sender, baseInRaw);
        baseToken.forceApprove(address(pool), baseInRaw);
        // nonReentrant is active before any token or pool call.
        // forge-lint: disable-next-line(reentrancy-no-eth)
        quote = pool.sellExactInput(
            baseInRaw, minimumQuoteOutRaw, minimumPriceX18, recipient, deadline
        );
        baseToken.forceApprove(address(pool), 0);
    }

    function buyExactOutput(
        VirtualPool pool,
        uint256 baseOutRaw,
        uint256 maximumGrossQuoteInRaw,
        uint256 maximumPriceX18,
        address recipient,
        uint256 deadline
    ) external nonReentrant returns (VirtualPool.BuyQuote memory quote) {
        _validatePool(pool);
        quote = pool.quoteBuyExactOutput(baseOutRaw);
        if (quote.grossQuoteConsumedRaw > maximumGrossQuoteInRaw) revert SlippageExceeded();
        address quoteToken = pool.quoteToken();
        quoteToken.pullExact(msg.sender, quote.grossQuoteConsumedRaw);
        quoteToken.forceApprove(address(pool), quote.grossQuoteConsumedRaw);
        // nonReentrant is active before any token or pool call.
        // forge-lint: disable-next-line(reentrancy-no-eth)
        quote = pool.buyExactOutput(
            baseOutRaw, maximumGrossQuoteInRaw, maximumPriceX18, recipient, deadline
        );
        quoteToken.forceApprove(address(pool), 0);
    }

    function sellExactOutput(
        VirtualPool pool,
        uint256 quoteOutRaw,
        uint256 maximumBaseInRaw,
        uint256 minimumPriceX18,
        address recipient,
        uint256 deadline
    ) external nonReentrant returns (VirtualPool.SellQuote memory quote) {
        _validatePool(pool);
        quote = pool.quoteSellExactOutput(quoteOutRaw);
        if (quote.baseInRaw > maximumBaseInRaw) revert SlippageExceeded();
        address baseToken = pool.baseToken();
        baseToken.pullExact(msg.sender, quote.baseInRaw);
        baseToken.forceApprove(address(pool), quote.baseInRaw);
        // nonReentrant is active before any token or pool call.
        // forge-lint: disable-next-line(reentrancy-no-eth)
        quote = pool.sellExactOutput(
            quoteOutRaw, maximumBaseInRaw, minimumPriceX18, recipient, deadline
        );
        baseToken.forceApprove(address(pool), 0);
    }

    function _validatePool(VirtualPool pool) private view returns (bytes32 launchId) {
        launchId = factory.launchByPool(address(pool));
        if (launchId == bytes32(0)) revert InvalidPool();
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

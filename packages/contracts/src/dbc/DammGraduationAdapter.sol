// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { PoolFactory } from "../core/PoolFactory.sol";
import { DammPool } from "../core/DammPool.sol";
import { PoolModel } from "../core/PoolTypes.sol";
import { IERC20Minimal } from "../interfaces/IERC20Minimal.sol";
import { TokenTransfer } from "../libraries/TokenTransfer.sol";
import { FullMath } from "../math/FullMath.sol";
import { BondingCurveMath } from "./BondingCurveMath.sol";

/// @notice Versioned, non-upgradeable boundary between DBC graduation and DAMM.
contract DammGraduationAdapter {
    using TokenTransfer for address;

    error InvalidMigration();
    error PriceOutsideTolerance();
    error Unauthorized();

    address public immutable manager;
    PoolFactory public immutable poolFactory;

    struct Migration {
        address baseToken;
        address quoteToken;
        uint8 baseDecimals;
        uint8 quoteDecimals;
        uint24 feePips;
        uint16 toleranceBps;
        uint256 baseAmount;
        uint256 quoteAmount;
        uint256 expectedPriceX18;
        uint256 minimumShares;
        address lpRecipient;
        uint256 deadline;
    }

    constructor(address manager_, PoolFactory poolFactory_) {
        if (manager_ == address(0) || address(poolFactory_) == address(0)) {
            revert InvalidMigration();
        }
        manager = manager_;
        poolFactory = poolFactory_;
    }

    function migrate(Migration calldata migration)
        external
        returns (address pool, uint256 shares)
    {
        if (msg.sender != manager) revert Unauthorized();
        if (
            migration.baseAmount == 0 || migration.quoteAmount == 0
                || migration.lpRecipient == address(0) || migration.expectedPriceX18 == 0
                || migration.toleranceBps > 10_000
        ) revert InvalidMigration();
        uint256 baseX18 =
            BondingCurveMath.normalizeToX18(migration.baseAmount, migration.baseDecimals);
        uint256 quoteX18 =
            BondingCurveMath.normalizeToX18(migration.quoteAmount, migration.quoteDecimals);
        uint256 actualPriceX18 = FullMath.mulDiv(quoteX18, 1e18, baseX18);
        uint256 difference = actualPriceX18 > migration.expectedPriceX18
            ? actualPriceX18 - migration.expectedPriceX18
            : migration.expectedPriceX18 - actualPriceX18;
        if (
            FullMath.mulDiv(difference, 10_000, migration.expectedPriceX18)
                > migration.toleranceBps
        ) {
            revert PriceOutsideTolerance();
        }

        migration.baseToken.pullExact(msg.sender, migration.baseAmount);
        migration.quoteToken.pullExact(msg.sender, migration.quoteAmount);
        pool = poolFactory.createPool(
            migration.baseToken,
            migration.quoteToken,
            PoolModel.DAMM,
            migration.feePips,
            0
        );
        migration.baseToken.forceApprove(pool, migration.baseAmount);
        migration.quoteToken.forceApprove(pool, migration.quoteAmount);
        DammPool dammPool = DammPool(pool);
        (uint256 amount0, uint256 amount1) = dammPool.token0() == migration.baseToken
            ? (migration.baseAmount, migration.quoteAmount)
            : (migration.quoteAmount, migration.baseAmount);
        shares = dammPool.addLiquidity(
            amount0,
            amount1,
            migration.minimumShares,
            migration.lpRecipient,
            migration.deadline
        );
        migration.baseToken.forceApprove(pool, 0);
        migration.quoteToken.forceApprove(pool, 0);
        if (
            IERC20Minimal(migration.baseToken).balanceOf(address(this)) != 0
                || IERC20Minimal(migration.quoteToken).balanceOf(address(this)) != 0
        ) revert InvalidMigration();
    }
}

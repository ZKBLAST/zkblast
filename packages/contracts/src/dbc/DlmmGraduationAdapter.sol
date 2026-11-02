// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DlmmPool } from "../core/DlmmPool.sol";
import { PoolFactory } from "../core/PoolFactory.sol";
import { IERC20Minimal } from "../interfaces/IERC20Minimal.sol";
import { BinPriceMath } from "../math/BinPriceMath.sol";
import { FullMath } from "../math/FullMath.sol";
import { TokenTransfer } from "../libraries/TokenTransfer.sol";
import { BondingCurveMath } from "./BondingCurveMath.sol";
import { DbcTypes } from "./DbcTypes.sol";
import { IGraduationAdapter } from "./IGraduationAdapter.sol";

/// @notice Versioned, single-bin graduation boundary for the current ZKBLAST DLMM.
contract DlmmGraduationAdapter is IGraduationAdapter {
    using TokenTransfer for address;

    error InvalidMigration();
    error PriceOutsideTolerance();
    error Unauthorized();

    address public immutable manager;
    address public immutable poolAdministrator;
    PoolFactory public immutable poolFactory;
    uint16 public immutable binStepBps;

    constructor(
        address manager_,
        PoolFactory poolFactory_,
        address poolAdministrator_,
        uint16 binStepBps_
    ) {
        if (
            manager_ == address(0) || address(poolFactory_) == address(0)
                || poolAdministrator_ == address(0) || binStepBps_ == 0 || binStepBps_ > 1_000
        ) revert InvalidMigration();
        manager = manager_;
        poolFactory = poolFactory_;
        poolAdministrator = poolAdministrator_;
        binStepBps = binStepBps_;
    }

    function migrationMode() external pure returns (DbcTypes.MigrationMode) {
        return DbcTypes.MigrationMode.DLMM;
    }

    function adapterVersion() external pure returns (uint32) {
        return 1;
    }

    function factory() external view returns (address) {
        return address(poolFactory);
    }

    function configurationHash() external view returns (bytes32) {
        return keccak256(
            abi.encode(
                uint32(1),
                DbcTypes.MigrationMode.DLMM,
                poolFactory,
                poolAdministrator,
                binStepBps
            )
        );
    }

    function migrate(Migration calldata migration)
        external
        returns (address pool, uint256 shares, int24 positionBin)
    {
        if (msg.sender != manager) revert Unauthorized();
        if (
            migration.baseAmount == 0 || migration.quoteAmount == 0
                || migration.lpRecipient == address(0) || migration.expectedPriceX18 == 0
                || migration.toleranceBps > 10_000
        ) revert InvalidMigration();
        _validatePrice(migration);

        migration.baseToken.pullExact(msg.sender, migration.baseAmount);
        migration.quoteToken.pullExact(msg.sender, migration.quoteAmount);
        uint256 rawToken1PerToken0X18 = migration.baseToken < migration.quoteToken
            ? FullMath.mulDiv(migration.quoteAmount, 1e18, migration.baseAmount)
            : FullMath.mulDiv(migration.baseAmount, 1e18, migration.quoteAmount);
        positionBin = _closestBin(rawToken1PerToken0X18, migration.toleranceBps);
        (pool, shares) = _createAndSeed(migration, positionBin);
        migration.baseToken.forceApprove(pool, 0);
        migration.quoteToken.forceApprove(pool, 0);
        DlmmPool dlmmPool = DlmmPool(pool);
        if (
            dlmmPool.activeBin() != positionBin || dlmmPool.binStepBps() != binStepBps
                || dlmmPool.sharesOf(positionBin, migration.lpRecipient) != shares
                || IERC20Minimal(migration.baseToken).balanceOf(address(this)) != 0
                || IERC20Minimal(migration.quoteToken).balanceOf(address(this)) != 0
        ) revert InvalidMigration();
        dlmmPool.setProtocolFeeConfiguration(poolAdministrator, 0);
        dlmmPool.setAdministrator(poolAdministrator);
    }

    function _createAndSeed(Migration calldata migration, int24 positionBin)
        private
        returns (address pool, uint256 shares)
    {
        pool = poolFactory.createDlmmPool(
            migration.baseToken,
            migration.quoteToken,
            migration.feePips,
            binStepBps,
            positionBin
        );
        migration.baseToken.forceApprove(pool, migration.baseAmount);
        migration.quoteToken.forceApprove(pool, migration.quoteAmount);
        DlmmPool dlmmPool = DlmmPool(pool);
        (uint256 amount0, uint256 amount1) = migration.baseToken < migration.quoteToken
            ? (migration.baseAmount, migration.quoteAmount)
            : (migration.quoteAmount, migration.baseAmount);
        shares = dlmmPool.addLiquidity(
            positionBin,
            amount0,
            amount1,
            migration.minimumShares,
            migration.lpRecipient,
            migration.deadline
        );
    }

    function _validatePrice(Migration calldata migration) private pure {
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
        ) revert PriceOutsideTolerance();
    }

    function _closestBin(uint256 targetPriceX18, uint16 toleranceBps)
        private
        view
        returns (int24 result)
    {
        if (targetPriceX18 == 0) revert InvalidMigration();
        int24 low = -10_000;
        int24 high = 10_000;
        while (low < high) {
            int24 middle = low + (high - low) / 2;
            if (BinPriceMath.priceFromBin(middle, binStepBps) < targetPriceX18) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        if (low == -10_000) {
            result = low;
        } else {
            uint256 upper = BinPriceMath.priceFromBin(low, binStepBps);
            uint256 lower = BinPriceMath.priceFromBin(low - 1, binStepBps);
            result = targetPriceX18 - lower <= upper - targetPriceX18 ? low - 1 : low;
        }
        uint256 selectedPrice = BinPriceMath.priceFromBin(result, binStepBps);
        uint256 difference = selectedPrice > targetPriceX18
            ? selectedPrice - targetPriceX18
            : targetPriceX18 - selectedPrice;
        if (FullMath.mulDiv(difference, 10_000, targetPriceX18) > toleranceBps) {
            revert PriceOutsideTolerance();
        }
    }
}

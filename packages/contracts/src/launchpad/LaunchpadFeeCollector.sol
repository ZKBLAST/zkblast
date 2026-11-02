// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { VirtualPool } from "../dbc/VirtualPool.sol";
import { IERC20Minimal } from "../interfaces/IERC20Minimal.sol";
import { ReentrancyGuard } from "../security/ReentrancyGuard.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { RevenueSplitter } from "./RevenueSplitter.sol";

/// @notice Pulls launchpad DBC fees into their immutable RevenueSplitter snapshot.
contract LaunchpadFeeCollector is ProtocolAccess, UUPSUpgradeable, ReentrancyGuard {
    error InvalidPool();
    error PoolAlreadyRegistered();
    error NoFeesAvailable();
    error ApprovalFailed();

    struct PoolRevenue {
        bytes32 snapshotId;
        address asset;
        bool registered;
    }

    RevenueSplitter public revenueSplitter;
    mapping(address pool => PoolRevenue revenue) private _poolRevenue;

    event FeePoolRegistered(
        address indexed pool, bytes32 indexed snapshotId, address indexed asset
    );
    event TradeFeesCollected(
        address indexed pool,
        bytes32 indexed snapshotId,
        address indexed asset,
        uint256 amount
    );

    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address upgrader, RevenueSplitter revenueSplitter_)
        external
        initializer
    {
        if (address(revenueSplitter_) == address(0)) revert InvalidPool();
        __ProtocolAccess_init(admin, upgrader);
        revenueSplitter = revenueSplitter_;
    }

    function registerPool(address pool, bytes32 snapshotId, address asset)
        external
        onlyRole(FACTORY_ROLE)
    {
        if (
            pool == address(0) || pool.code.length == 0 || snapshotId == bytes32(0)
                || asset == address(0) || VirtualPool(pool).feeCollector() != address(this)
                || VirtualPool(pool).quoteToken() != asset
        ) revert InvalidPool();
        if (_poolRevenue[pool].registered) revert PoolAlreadyRegistered();
        _poolRevenue[pool] =
            PoolRevenue({ snapshotId: snapshotId, asset: asset, registered: true });
        emit FeePoolRegistered(pool, snapshotId, asset);
    }

    function collectTradeFees(VirtualPool pool) external nonReentrant returns (uint256 amount) {
        PoolRevenue memory item = _poolRevenue[address(pool)];
        if (!item.registered) revert InvalidPool();
        uint256 beforeBalance = IERC20Minimal(item.asset).balanceOf(address(this));
        for (uint8 allocation; allocation < 3; ++allocation) {
            try pool.claimFees(allocation) returns (uint256) { } catch { }
        }
        uint256 afterBalance = IERC20Minimal(item.asset).balanceOf(address(this));
        amount = afterBalance - beforeBalance;
        if (amount == 0) revert NoFeesAvailable();
        if (!IERC20Minimal(item.asset).approve(address(revenueSplitter), amount)) {
            revert ApprovalFailed();
        }
        revenueSplitter.accrue(
            item.snapshotId, RevenueSplitter.RevenueKind.TRADE_FEE, amount
        );
        emit TradeFeesCollected(address(pool), item.snapshotId, item.asset, amount);
    }

    function poolRevenue(address pool) external view returns (PoolRevenue memory item) {
        item = _poolRevenue[pool];
        if (!item.registered) revert InvalidPool();
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

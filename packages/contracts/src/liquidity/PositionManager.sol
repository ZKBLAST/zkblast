// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { DammPool } from "../core/DammPool.sol";
import { DlmmPool } from "../core/DlmmPool.sol";
import { PoolRegistry } from "../core/PoolRegistry.sol";
import { PoolModel } from "../core/PoolTypes.sol";
import { TokenTransfer } from "../libraries/TokenTransfer.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { ReentrancyGuard } from "../security/ReentrancyGuard.sol";

contract PositionManager is ProtocolAccess, UUPSUpgradeable, ReentrancyGuard {
    using TokenTransfer for address;

    struct Position {
        address owner;
        address pool;
        PoolModel model;
        int24 binId;
        uint256 shares;
    }

    error InvalidPool();
    error InvalidPosition();
    error UnauthorizedPosition();

    PoolRegistry public registry;
    uint256 public nextPositionId;
    mapping(uint256 positionId => Position position) public positions;

    event PositionCreated(
        uint256 indexed positionId,
        address indexed owner,
        address indexed pool,
        PoolModel model,
        int24 binId,
        uint256 shares
    );
    event PositionIncreased(uint256 indexed positionId, uint256 sharesAdded, uint256 totalShares);
    event PositionDecreased(
        uint256 indexed positionId,
        address indexed recipient,
        uint256 sharesRemoved,
        uint256 amount0,
        uint256 amount1
    );
    event PositionTransferred(
        uint256 indexed positionId, address indexed previousOwner, address indexed nextOwner
    );

    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address upgrader, PoolRegistry registry_)
        external
        initializer
    {
        if (address(registry_) == address(0)) revert InvalidPool();
        __ProtocolAccess_init(admin, upgrader);
        registry = registry_;
        nextPositionId = 1;
    }

    function createDammPosition(
        DammPool pool,
        uint256 amount0,
        uint256 amount1,
        uint256 minimumShares,
        uint256 deadline
    ) external nonReentrant returns (uint256 positionId, uint256 shares) {
        _validatePool(address(pool));
        _fundPool(pool.token0(), pool.token1(), address(pool), amount0, amount1);
        shares = pool.addLiquidity(amount0, amount1, minimumShares, address(this), deadline);
        _clearApprovals(pool.token0(), pool.token1(), address(pool));
        positionId = _createPosition(msg.sender, address(pool), PoolModel.DAMM, 0, shares);
    }

    function createDlmmPosition(
        DlmmPool pool,
        int24 binId,
        uint256 amount0,
        uint256 amount1,
        uint256 minimumShares,
        uint256 deadline
    ) external nonReentrant returns (uint256 positionId, uint256 shares) {
        _validatePool(address(pool));
        _fundPool(pool.token0(), pool.token1(), address(pool), amount0, amount1);
        shares = pool.addLiquidity(binId, amount0, amount1, minimumShares, address(this), deadline);
        _clearApprovals(pool.token0(), pool.token1(), address(pool));
        positionId = _createPosition(msg.sender, address(pool), PoolModel.DLMM, binId, shares);
    }

    function increasePosition(
        uint256 positionId,
        uint256 amount0,
        uint256 amount1,
        uint256 minimumShares,
        uint256 deadline
    ) external nonReentrant returns (uint256 sharesAdded) {
        Position storage position = _ownedPosition(positionId);
        if (position.model == PoolModel.DAMM) {
            DammPool pool = DammPool(position.pool);
            _fundPool(pool.token0(), pool.token1(), position.pool, amount0, amount1);
            sharesAdded =
                pool.addLiquidity(amount0, amount1, minimumShares, address(this), deadline);
            _clearApprovals(pool.token0(), pool.token1(), position.pool);
        } else {
            DlmmPool pool = DlmmPool(position.pool);
            _fundPool(pool.token0(), pool.token1(), position.pool, amount0, amount1);
            sharesAdded = pool.addLiquidity(
                position.binId, amount0, amount1, minimumShares, address(this), deadline
            );
            _clearApprovals(pool.token0(), pool.token1(), position.pool);
        }
        position.shares += sharesAdded;
        emit PositionIncreased(positionId, sharesAdded, position.shares);
    }

    function decreasePosition(
        uint256 positionId,
        uint256 shares,
        uint256 minimumAmount0,
        uint256 minimumAmount1,
        address recipient,
        uint256 deadline
    ) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        Position storage position = _ownedPosition(positionId);
        if (shares == 0 || shares > position.shares) revert InvalidPosition();
        if (position.model == PoolModel.DAMM) {
            (amount0, amount1) = DammPool(position.pool)
                .removeLiquidity(shares, minimumAmount0, minimumAmount1, recipient, deadline);
        } else {
            (amount0, amount1) = DlmmPool(position.pool)
                .removeLiquidity(
                    position.binId, shares, minimumAmount0, minimumAmount1, recipient, deadline
                );
        }
        position.shares -= shares;
        emit PositionDecreased(positionId, recipient, shares, amount0, amount1);
        if (position.shares == 0) delete positions[positionId];
    }

    function transferPosition(uint256 positionId, address nextOwner) external {
        if (nextOwner == address(0)) revert InvalidPosition();
        Position storage position = _ownedPosition(positionId);
        address previousOwner = position.owner;
        position.owner = nextOwner;
        emit PositionTransferred(positionId, previousOwner, nextOwner);
    }

    function _createPosition(
        address owner,
        address pool,
        PoolModel model,
        int24 binId,
        uint256 shares
    ) private returns (uint256 positionId) {
        positionId = nextPositionId++;
        positions[positionId] = Position(owner, pool, model, binId, shares);
        emit PositionCreated(positionId, owner, pool, model, binId, shares);
    }

    function _fundPool(
        address token0,
        address token1,
        address pool,
        uint256 amount0,
        uint256 amount1
    ) private {
        token0.pullExact(msg.sender, amount0);
        token1.pullExact(msg.sender, amount1);
        token0.forceApprove(pool, amount0);
        token1.forceApprove(pool, amount1);
    }

    function _clearApprovals(address token0, address token1, address pool) private {
        token0.forceApprove(pool, 0);
        token1.forceApprove(pool, 0);
    }

    function _ownedPosition(uint256 positionId) private view returns (Position storage position) {
        position = positions[positionId];
        if (position.owner == address(0)) revert InvalidPosition();
        if (position.owner != msg.sender) revert UnauthorizedPosition();
    }

    function _validatePool(address pool) private view {
        if (!registry.isRegisteredPool(pool)) revert InvalidPool();
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}

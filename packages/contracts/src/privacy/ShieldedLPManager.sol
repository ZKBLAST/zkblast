// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DammPool } from "../core/DammPool.sol";
import { PoolRegistry } from "../core/PoolRegistry.sol";
import { IERC20Minimal } from "../interfaces/IERC20Minimal.sol";
import { TokenTransfer } from "../libraries/TokenTransfer.sol";
import { FullMath } from "../math/FullMath.sol";
import { ReentrancyGuard } from "../security/ReentrancyGuard.sol";

/// @notice Holds one aggregate public DAMM position on behalf of one shielded vault.
/// @dev This contract does not create user claims. The vault remains authoritative for liabilities.
contract ShieldedLPManager is ReentrancyGuard {
    using TokenTransfer for address;

    error InvalidConfiguration();
    error UnauthorizedVault();
    error ManagerPaused();
    error InvalidShareAmount();
    error UnauthorizedAdministrator();

    address public immutable administrator;
    address public immutable vault;
    DammPool public immutable pool;
    address public immutable token0;
    address public immutable token1;
    bool public paused;

    event PauseUpdated(bool paused);
    event AggregatePositionIncreased(uint256 amount0, uint256 amount1, uint256 sharesAdded);
    event AggregatePositionDecreased(uint256 sharesRemoved, uint256 amount0, uint256 amount1);
    event EmergencyExit(uint256 sharesRemoved, uint256 amount0, uint256 amount1);

    modifier onlyVault() {
        if (msg.sender != vault) revert UnauthorizedVault();
        _;
    }

    modifier onlyAdministrator() {
        if (msg.sender != administrator) revert UnauthorizedAdministrator();
        _;
    }

    constructor(address admin, address vault_, PoolRegistry registry, DammPool pool_) {
        if (
            admin == address(0) || vault_ == address(0) || address(registry) == address(0)
                || address(pool_) == address(0) || !registry.isRegisteredPool(address(pool_))
        ) revert InvalidConfiguration();
        administrator = admin;
        vault = vault_;
        pool = pool_;
        token0 = pool_.token0();
        token1 = pool_.token1();
    }

    function setPaused(bool paused_) external onlyAdministrator {
        paused = paused_;
        emit PauseUpdated(paused_);
    }

    function invest(uint256 amount0, uint256 amount1, uint256 minimumShares, uint256 deadline)
        external
        onlyVault
        nonReentrant
        returns (uint256 sharesAdded)
    {
        if (paused) revert ManagerPaused();
        if (amount0 == 0 || amount1 == 0) revert InvalidConfiguration();
        token0.pullExact(vault, amount0);
        token1.pullExact(vault, amount1);
        token0.forceApprove(address(pool), amount0);
        token1.forceApprove(address(pool), amount1);
        sharesAdded = pool.addLiquidity(amount0, amount1, minimumShares, address(this), deadline);
        token0.forceApprove(address(pool), 0);
        token1.forceApprove(address(pool), 0);
        emit AggregatePositionIncreased(amount0, amount1, sharesAdded);
    }

    function divest(
        uint256 shares,
        uint256 minimumAmount0,
        uint256 minimumAmount1,
        uint256 deadline
    ) external onlyVault nonReentrant returns (uint256 amount0, uint256 amount1) {
        (amount0, amount1) = _divest(shares, minimumAmount0, minimumAmount1, deadline);
        emit AggregatePositionDecreased(shares, amount0, amount1);
    }

    function emergencyExit(uint256 minimumAmount0, uint256 minimumAmount1, uint256 deadline)
        external
        onlyAdministrator
        nonReentrant
        returns (uint256 amount0, uint256 amount1)
    {
        paused = true;
        uint256 shares = managedShares();
        if (shares == 0) revert InvalidShareAmount();
        (amount0, amount1) = _divest(shares, minimumAmount0, minimumAmount1, deadline);
        emit PauseUpdated(true);
        emit EmergencyExit(shares, amount0, amount1);
    }

    function managedShares() public view returns (uint256) {
        return pool.sharesOf(address(this));
    }

    function previewAssets() public view returns (uint256 amount0, uint256 amount1) {
        uint256 shares = managedShares();
        uint256 supply = pool.totalShares();
        if (shares == 0 || supply == 0) return (0, 0);
        amount0 = FullMath.mulDiv(shares, pool.reserve0(), supply);
        amount1 = FullMath.mulDiv(shares, pool.reserve1(), supply);
    }

    function _divest(
        uint256 shares,
        uint256 minimumAmount0,
        uint256 minimumAmount1,
        uint256 deadline
    ) private returns (uint256 amount0, uint256 amount1) {
        if (shares == 0 || shares > managedShares()) revert InvalidShareAmount();
        (amount0, amount1) =
            pool.removeLiquidity(shares, minimumAmount0, minimumAmount1, address(this), deadline);
        token0.pushExact(vault, amount0);
        token1.pushExact(vault, amount1);
    }
}

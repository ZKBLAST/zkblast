// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { DlmmPoolV2 } from "../core/DlmmPoolV2.sol";
import { TokenTransfer } from "../libraries/TokenTransfer.sol";
import { PositionManager } from "./PositionManager.sol";

contract PositionManagerV2 is PositionManager {
    using TokenTransfer for address;

    uint16 public constant BPS_DENOMINATOR = 10_000;

    struct RangePosition {
        address owner;
        address pool;
        int24 lowerBin;
        int24 upperBin;
        bool open;
    }

    error InvalidRange();

    // Appended after every v1 storage field. Existing v1 positions remain untouched.
    uint256 public nextRangePositionId;
    mapping(uint256 => RangePosition) public rangePositions;
    mapping(uint256 => int24[]) private _rangeBins;
    mapping(uint256 => mapping(int24 => uint256)) public rangeShares;

    function rangeVersion() external pure returns (uint8) {
        return 2;
    }

    event RangePositionCreated(
        uint256 indexed rangePositionId,
        address indexed owner,
        address indexed pool,
        int24 lowerBin,
        int24 upperBin,
        int24 activeBin
    );
    event RangePositionIncreased(
        uint256 indexed rangePositionId,
        bytes32 indexed operationId,
        uint256 amount0,
        uint256 amount1,
        int24 activeBin
    );
    event RangePositionDecreased(
        uint256 indexed rangePositionId,
        bytes32 indexed operationId,
        address indexed recipient,
        uint16 shareBps,
        uint256 amount0,
        uint256 amount1,
        int24 activeBin
    );
    event RangePositionClosed(uint256 indexed rangePositionId, address indexed recipient);
    event RangePositionTransferred(
        uint256 indexed rangePositionId, address indexed previousOwner, address indexed nextOwner
    );

    function createRangePosition(
        DlmmPoolV2 pool,
        DlmmPoolV2.AddBin[] calldata additions,
        int24 expectedActiveBin,
        uint256 deadline
    ) external nonReentrant returns (uint256 rangePositionId) {
        _validateRangePool(address(pool));
        if (additions.length == 0) revert InvalidRange();
        rangePositionId = ++nextRangePositionId;
        bytes32 operationId = keccak256(
            abi.encode(block.chainid, address(this), rangePositionId, uint256(1))
        );
        _fundRangePool(pool, additions);
        uint256[] memory beforeShares = _sharesBefore(pool, additions);
        (uint256 amount0, uint256 amount1) = pool.addLiquidityBatch(
            operationId, additions, expectedActiveBin, address(this), deadline
        );
        _clearRangeApprovals(pool);
        rangePositions[rangePositionId] = RangePosition(
            msg.sender,
            address(pool),
            additions[0].binId,
            additions[additions.length - 1].binId,
            true
        );
        for (uint256 index = 0; index < additions.length; ++index) {
            int24 binId = additions[index].binId;
            uint256 minted = pool.sharesOf(binId, address(this)) - beforeShares[index];
            if (minted == 0) revert InvalidRange();
            _rangeBins[rangePositionId].push(binId);
            rangeShares[rangePositionId][binId] = minted;
        }
        _emitRangeCreated(rangePositionId, operationId, amount0, amount1, pool);
    }

    function increaseRangePosition(
        uint256 rangePositionId,
        DlmmPoolV2.AddBin[] calldata additions,
        int24 expectedActiveBin,
        uint256 deadline
    ) external nonReentrant {
        RangePosition storage position = _ownedRangePosition(rangePositionId);
        DlmmPoolV2 pool = DlmmPoolV2(position.pool);
        for (uint256 index = 0; index < additions.length; ++index) {
            if (
                additions[index].binId < position.lowerBin
                    || additions[index].binId > position.upperBin
                    || rangeShares[rangePositionId][additions[index].binId] == 0
            ) revert InvalidRange();
        }
        bytes32 operationId = keccak256(
            abi.encode(block.chainid, address(this), rangePositionId, block.number, uint256(2))
        );
        _fundRangePool(pool, additions);
        uint256[] memory beforeShares = _sharesBefore(pool, additions);
        (uint256 amount0, uint256 amount1) = pool.addLiquidityBatch(
            operationId, additions, expectedActiveBin, address(this), deadline
        );
        _clearRangeApprovals(pool);
        for (uint256 index = 0; index < additions.length; ++index) {
            int24 binId = additions[index].binId;
            rangeShares[rangePositionId][binId] +=
                pool.sharesOf(binId, address(this)) - beforeShares[index];
        }
        emit RangePositionIncreased(
            rangePositionId, operationId, amount0, amount1, pool.activeBin()
        );
    }

    function decreaseRangePosition(
        uint256 rangePositionId,
        uint16 shareBps,
        uint256 minimumAmount0,
        uint256 minimumAmount1,
        address recipient,
        uint256 deadline
    ) public nonReentrant returns (uint256 amount0, uint256 amount1) {
        if (shareBps == 0 || shareBps > BPS_DENOMINATOR) revert InvalidRange();
        RangePosition storage position = _ownedRangePosition(rangePositionId);
        DlmmPoolV2.RemoveBin[] memory removals = _buildRemovals(rangePositionId, shareBps);
        bytes32 operationId = keccak256(
            abi.encode(block.chainid, address(this), rangePositionId, block.number, shareBps)
        );
        DlmmPoolV2 pool = DlmmPoolV2(position.pool);
        (amount0, amount1) = pool.removeLiquidityBatch(
            operationId, removals, minimumAmount0, minimumAmount1, recipient, deadline
        );
        emit RangePositionDecreased(
            rangePositionId,
            operationId,
            recipient,
            shareBps,
            amount0,
            amount1,
            pool.activeBin()
        );
        if (shareBps == BPS_DENOMINATOR) {
            position.open = false;
            emit RangePositionClosed(rangePositionId, recipient);
        }
    }

    function closeRangePosition(
        uint256 rangePositionId,
        uint256 minimumAmount0,
        uint256 minimumAmount1,
        address recipient,
        uint256 deadline
    ) external returns (uint256 amount0, uint256 amount1) {
        return decreaseRangePosition(
            rangePositionId,
            BPS_DENOMINATOR,
            minimumAmount0,
            minimumAmount1,
            recipient,
            deadline
        );
    }

    function transferRangePosition(uint256 rangePositionId, address nextOwner) external {
        if (nextOwner == address(0)) revert InvalidRange();
        RangePosition storage position = _ownedRangePosition(rangePositionId);
        address previousOwner = position.owner;
        position.owner = nextOwner;
        emit RangePositionTransferred(rangePositionId, previousOwner, nextOwner);
    }

    function rangeBins(uint256 rangePositionId) external view returns (int24[] memory) {
        return _rangeBins[rangePositionId];
    }

    function _fundRangePool(DlmmPoolV2 pool, DlmmPoolV2.AddBin[] calldata additions) private {
        uint256 amount0;
        uint256 amount1;
        for (uint256 index = 0; index < additions.length; ++index) {
            amount0 += additions[index].amount0;
            amount1 += additions[index].amount1;
        }
        address token0 = pool.token0();
        address token1 = pool.token1();
        if (amount0 != 0) token0.pullExact(msg.sender, amount0);
        if (amount1 != 0) token1.pullExact(msg.sender, amount1);
        token0.forceApprove(address(pool), amount0);
        token1.forceApprove(address(pool), amount1);
    }

    function _buildRemovals(uint256 rangePositionId, uint16 shareBps)
        private
        returns (DlmmPoolV2.RemoveBin[] memory removals)
    {
        int24[] storage bins = _rangeBins[rangePositionId];
        removals = new DlmmPoolV2.RemoveBin[](bins.length);
        for (uint256 index = 0; index < bins.length; ++index) {
            int24 binId = bins[index];
            uint256 shares = rangeShares[rangePositionId][binId];
            uint256 removing = shareBps == BPS_DENOMINATOR
                ? shares
                : shares * shareBps / BPS_DENOMINATOR;
            if (removing == 0) revert InvalidRange();
            removals[index] = DlmmPoolV2.RemoveBin(binId, removing, 0, 0);
            rangeShares[rangePositionId][binId] = shares - removing;
        }
    }

    function _emitRangeCreated(
        uint256 rangePositionId,
        bytes32 operationId,
        uint256 amount0,
        uint256 amount1,
        DlmmPoolV2 pool
    ) private {
        RangePosition storage position = rangePositions[rangePositionId];
        int24 current = pool.activeBin();
        emit RangePositionCreated(
            rangePositionId,
            position.owner,
            position.pool,
            position.lowerBin,
            position.upperBin,
            current
        );
        emit RangePositionIncreased(rangePositionId, operationId, amount0, amount1, current);
    }

    function _clearRangeApprovals(DlmmPoolV2 pool) private {
        pool.token0().forceApprove(address(pool), 0);
        pool.token1().forceApprove(address(pool), 0);
    }

    function _sharesBefore(DlmmPoolV2 pool, DlmmPoolV2.AddBin[] calldata additions)
        private
        view
        returns (uint256[] memory shares)
    {
        shares = new uint256[](additions.length);
        for (uint256 index = 0; index < additions.length; ++index) {
            shares[index] = pool.sharesOf(additions[index].binId, address(this));
        }
    }

    function _ownedRangePosition(uint256 rangePositionId)
        private
        view
        returns (RangePosition storage position)
    {
        position = rangePositions[rangePositionId];
        if (!position.open || position.owner == address(0)) revert InvalidRange();
        if (position.owner != msg.sender) revert UnauthorizedPosition();
    }

    function _validateRangePool(address pool) private view {
        if (!registry.isRegisteredPool(pool)) revert InvalidPool();
        if (DlmmPoolV2(pool).version() != 2) revert InvalidPool();
    }
}

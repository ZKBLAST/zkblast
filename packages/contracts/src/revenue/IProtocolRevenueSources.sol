// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface ILaunchpadRevenueSplitter {
    function claim(bytes32 snapshotId) external returns (uint256 amount);
}

interface IDbcProtocolFeeSource {
    function quoteToken() external view returns (address);
    function claimFees(uint8 allocation) external returns (uint256 amount);
}

interface IAmmProtocolFeeSource {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function protocolFeeRecipient() external view returns (address);
    function collectProtocolFees() external returns (uint256 amount0, uint256 amount1);
}

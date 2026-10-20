// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20Minimal } from "./IERC20Minimal.sol";

/// @notice Read-only token identity used by API and SDK consumers.
interface IERC20Metadata is IERC20Minimal {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
}

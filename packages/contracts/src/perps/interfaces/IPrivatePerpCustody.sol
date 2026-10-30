// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IPrivatePerpCustody {
    function treeVersion() external view returns (uint64);
    function isKnownRoot(bytes32 root) external view returns (bool);

    function consumePerpsNote(
        address asset,
        uint64 treeVersion_,
        bytes32 root,
        bytes32 nullifier,
        uint256 amount,
        address recipient
    ) external;

    function insertPerpsNote(address asset, uint256 amount, bytes32 commitment, address payer)
        external;
}

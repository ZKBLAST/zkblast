// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

abstract contract UUPSUpgradeable {
    error InvalidImplementation();
    error OnlyProxy();
    error UnsupportedProxiableUUID();
    error UpgradeCallFailed(bytes reason);

    bytes32 internal constant IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    address private immutable SELF = address(this);

    event Upgraded(address indexed implementation);

    modifier onlyProxy() {
        if (address(this) == SELF || _implementation() != SELF) revert OnlyProxy();
        _;
    }

    function proxiableUUID() external view returns (bytes32) {
        if (address(this) != SELF) revert OnlyProxy();
        return IMPLEMENTATION_SLOT;
    }

    function upgradeToAndCall(address implementation, bytes calldata data)
        external
        payable
        onlyProxy
    {
        _authorizeUpgrade(implementation);
        if (implementation.code.length == 0) revert InvalidImplementation();
        (bool success, bytes memory result) =
            implementation.staticcall(abi.encodeCall(this.proxiableUUID, ()));
        if (!success || abi.decode(result, (bytes32)) != IMPLEMENTATION_SLOT) {
            revert UnsupportedProxiableUUID();
        }
        assembly ("memory-safe") {
            sstore(IMPLEMENTATION_SLOT, implementation)
        }
        emit Upgraded(implementation);
        if (data.length != 0) {
            (success, result) = implementation.delegatecall(data);
            if (!success) revert UpgradeCallFailed(result);
        }
    }

    function _implementation() private view returns (address implementation) {
        assembly ("memory-safe") {
            implementation := sload(IMPLEMENTATION_SLOT)
        }
    }

    function _authorizeUpgrade(address implementation) internal virtual;
}

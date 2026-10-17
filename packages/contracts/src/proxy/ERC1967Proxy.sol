// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

contract ERC1967Proxy {
    error InvalidImplementation();
    error InitializationFailed(bytes reason);

    bytes32 private constant IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    constructor(address implementation, bytes memory initializationCall) payable {
        if (implementation.code.length == 0) revert InvalidImplementation();
        assembly ("memory-safe") {
            sstore(IMPLEMENTATION_SLOT, implementation)
        }
        if (initializationCall.length != 0) {
            (bool success, bytes memory reason) = implementation.delegatecall(initializationCall);
            if (!success) revert InitializationFailed(reason);
        }
    }

    fallback() external payable {
        _delegate();
    }

    receive() external payable {
        _delegate();
    }

    function _delegate() private {
        assembly ("memory-safe") {
            let implementation := sload(IMPLEMENTATION_SLOT)
            calldatacopy(0, 0, calldatasize())
            let success := delegatecall(gas(), implementation, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch success
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}

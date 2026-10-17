// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

abstract contract Initializable {
    error AlreadyInitialized();
    error NotInitializing();

    uint64 private _initialized;
    bool private _initializing;

    modifier initializer() {
        if (_initializing || _initialized != 0) revert AlreadyInitialized();
        _initialized = 1;
        _initializing = true;
        _;
        _initializing = false;
    }

    modifier onlyInitializing() {
        if (!_initializing) revert NotInitializing();
        _;
    }

    function _disableInitializers() internal {
        if (_initializing) revert AlreadyInitialized();
        _initialized = type(uint64).max;
    }
}

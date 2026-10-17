// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

abstract contract ReentrancyGuard {
    error ReentrantCall();

    uint256 private _status;

    modifier nonReentrant() {
        if (_status == 2) revert ReentrantCall();
        _status = 2;
        _;
        _status = 1;
    }
}

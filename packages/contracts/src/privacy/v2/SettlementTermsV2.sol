// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Pure draft v2 terms codec; does not authorize spends or hold funds.
/// @dev Future settlement must additionally enforce chain/address context,
/// verifier/root eligibility, nullifier uniqueness and actual pool accounting.
library SettlementTermsV2 {
    error InvalidTerms();

    bytes32 internal constant DOMAIN = keccak256("ZKBLAST_SHIELDED_SETTLEMENT_V2");

    struct Terms {
        uint64 chainId;
        address settlement;
        uint8 action;
        address pool;
        uint8 model;
        int24 binId;
        address asset0;
        address asset1;
        uint128 amount0;
        uint128 amount1;
        uint128 shares;
        uint128 minimum0;
        uint128 minimum1;
        uint128 minimumShares;
        uint128 maximumFee0;
        uint128 maximumFee1;
        address feeRecipient;
        uint64 deadline;
        bytes32 refundCommitment;
        bytes32 outputCommitment0;
        bytes32 outputCommitment1;
    }

    function hash(Terms memory terms) internal pure returns (bytes32) {
        validate(terms);
        // A fully static ABI tuple has the same encoding as its flattened fields.
        return keccak256(abi.encode(DOMAIN, terms));
    }

    function validate(Terms memory t) internal pure {
        if (
            t.chainId == 0 || t.settlement == address(0) || t.pool == address(0)
                || t.asset0 == address(0) || t.asset0 >= t.asset1 || t.feeRecipient == address(0)
                || t.deadline == 0 || t.model > 1 || (t.model == 0 && t.binId != 0)
                || t.refundCommitment == bytes32(0)
                || (t.outputCommitment0 != bytes32(0) && t.outputCommitment0 == t.outputCommitment1)
        ) revert InvalidTerms();

        if (t.action == 2) {
            if (
                (t.amount0 == 0) == (t.amount1 == 0) || t.shares != 0 || t.minimumShares != 0
                    || (t.outputCommitment0 == bytes32(0) && t.outputCommitment1 == bytes32(0))
                    || (t.amount0 > 0
                            ? t.minimum0 != 0 || t.minimum1 == 0
                            : t.minimum1 != 0 || t.minimum0 == 0)
            ) revert InvalidTerms();
        } else if (t.action == 3) {
            if (
                (t.amount0 == 0 && t.amount1 == 0) || t.shares != 0 || t.minimumShares == 0
                    || t.minimum0 != 0 || t.minimum1 != 0 || t.amount0 == 0 || t.amount1 == 0
            ) revert InvalidTerms();
        } else if (t.action == 4) {
            if (
                t.shares == 0 || t.amount0 != 0 || t.amount1 != 0 || t.minimumShares != 0
                    || (t.minimum0 == 0 && t.minimum1 == 0)
                    || (t.outputCommitment0 == bytes32(0) && t.outputCommitment1 == bytes32(0))
            ) revert InvalidTerms();
        } else {
            revert InvalidTerms();
        }
    }

    function limbs(bytes32 termsHash) internal pure returns (uint128 low, uint128 high) {
        low = uint128(uint256(termsHash));
        high = uint128(uint256(termsHash) >> 128);
    }
}

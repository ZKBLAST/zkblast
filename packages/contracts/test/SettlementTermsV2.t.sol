// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { SettlementTermsV2 } from "../src/privacy/v2/SettlementTermsV2.sol";

contract SettlementTermsV2Test {
    function fixture() private pure returns (SettlementTermsV2.Terms memory t) {
        address a = 0x1000000000000000000000000000000000000001;
        address b = 0x2000000000000000000000000000000000000002;
        t.chainId = 46630;
        t.settlement = a;
        t.action = 2;
        t.pool = b;
        t.model = 1;
        t.binId = -1;
        t.asset0 = a;
        t.asset1 = b;
        t.amount0 = 100;
        t.minimum1 = 90;
        t.maximumFee0 = 1;
        t.feeRecipient = b;
        t.deadline = 1000;
        t.refundCommitment = bytes32(uint256(1));
        t.outputCommitment0 = bytes32(uint256(2));
        t.outputCommitment1 = bytes32(uint256(3));
    }

    function checkedHash(SettlementTermsV2.Terms memory t) external pure returns (bytes32) {
        return SettlementTermsV2.hash(t);
    }

    function rejects(SettlementTermsV2.Terms memory t) private {
        (bool ok,) = address(this).call(abi.encodeCall(this.checkedHash, (t)));
        require(!ok, "invalid terms accepted");
    }

    function testMatchesSdkHashAndLosslessLimbs() public pure {
        bytes32 result = SettlementTermsV2.hash(fixture());
        require(
            result == 0xce98b953664fcde3252efef4108551a1a4e4161a13cceb7a25ce704fc883df8b,
            "SDK/Solidity hash mismatch"
        );
        (uint128 low, uint128 high) = SettlementTermsV2.limbs(result);
        require((uint256(high) << 128) | uint256(low) == uint256(result), "lossy limbs");
    }

    function testRejectsInvalidContextAndCommitments() public {
        SettlementTermsV2.Terms memory t = fixture();
        t.chainId = 0;
        rejects(t);
        t = fixture();
        t.settlement = address(0);
        rejects(t);
        t = fixture();
        t.asset1 = t.asset0;
        rejects(t);
        t = fixture();
        t.outputCommitment1 = t.outputCommitment0;
        rejects(t);
        t = fixture();
        t.deadline = 0;
        rejects(t);
    }

    function testRejectsUnboundedSwapAndWrongModel() public {
        SettlementTermsV2.Terms memory t = fixture();
        t.minimum1 = 0;
        rejects(t);
        t = fixture();
        t.amount1 = 1;
        rejects(t);
        t = fixture();
        t.model = 0;
        rejects(t);
        t = fixture();
        t.action = 1;
        rejects(t);
    }

    function testLpActionShapesAndDomains() public {
        SettlementTermsV2.Terms memory t = fixture();
        bytes32 swapHash = SettlementTermsV2.hash(t);
        t.action = 3;
        t.minimum1 = 0;
        t.minimumShares = 5;
        t.amount1 = 100;
        require(SettlementTermsV2.hash(t) != swapHash, "action not bound");
        t.model = 0;
        t.binId = 0;
        t.amount1 = 0;
        rejects(t); // Current pool models cannot add one-sided liquidity.
        t.amount1 = 100;
        SettlementTermsV2.validate(t);
        t.outputCommitment0 = bytes32(0);
        t.outputCommitment1 = bytes32(0);
        SettlementTermsV2.validate(t); // LP-only output lives in statement slot 19.
        t.outputCommitment0 = bytes32(uint256(2));
        t.outputCommitment1 = bytes32(uint256(3));
        t.action = 4;
        t.amount0 = 0;
        t.amount1 = 0;
        t.minimumShares = 0;
        t.shares = 5;
        t.minimum0 = 1;
        t.minimum1 = 1;
        SettlementTermsV2.validate(t);
        t.shares = 0;
        rejects(t);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtectedLaunchToken } from "../src/launchpad/protection/ProtectedLaunchToken.sol";
import {
    ProtectedLaunchTokenDeployer
} from "../src/launchpad/protection/ProtectedLaunchTokenDeployer.sol";

interface Vm {
    function roll(uint256 newHeight) external;
}

contract ProtectedTokenActor {
    function transferToken(ProtectedLaunchToken token, address recipient, uint256 amount)
        external
        returns (bool success)
    {
        (success,) = address(token)
            .call(abi.encodeCall(ProtectedLaunchToken.transfer, (recipient, amount)));
    }

    function bindPool(ProtectedLaunchToken token, address pool, uint64 startBlock)
        external
        returns (bool success)
    {
        (success,) = address(token)
            .call(abi.encodeCall(ProtectedLaunchToken.bindProtectedPool, (pool, startBlock)));
    }

    function bindDeployer(ProtectedLaunchTokenDeployer deployer, address factory)
        external
        returns (bool success)
    {
        (success,) = address(deployer)
            .call(abi.encodeCall(ProtectedLaunchTokenDeployer.bindFactory, (factory)));
    }
}

contract ProtectedLaunchTokenTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant SUPPLY = 1_000_000 ether;
    ProtectedLaunchToken private token;
    ProtectedTokenActor private pool;
    ProtectedTokenActor private buyer;
    ProtectedTokenActor private secondBuyer;

    function setUp() public {
        pool = new ProtectedTokenActor();
        buyer = new ProtectedTokenActor();
        secondBuyer = new ProtectedTokenActor();
        token = _deploy(100);
        token.transfer(address(pool), 800_000 ether);
        token.bindProtectedPool(address(pool), uint64(block.number));
    }

    function testEnforcesActualOutputPerTransactionAndCumulativeCap() external {
        require(pool.transferToken(token, address(buyer), 2_500 ether), "first buy");
        require(pool.transferToken(token, address(buyer), 2_500 ether), "second buy");
        require(!pool.transferToken(token, address(buyer), 2_501 ether), "tx cap bypassed");
        require(pool.transferToken(token, address(buyer), 2_500 ether), "third buy");
        require(pool.transferToken(token, address(buyer), 2_500 ether), "fourth buy");
        require(!pool.transferToken(token, address(buyer), 1), "address cap bypassed");
        require(
            token.purchasedDuringProtection(address(buyer)) == 10_000 ether, "cumulative allocation"
        );
    }

    function testTracksRecipientsIndependently() external {
        require(pool.transferToken(token, address(buyer), 2_500 ether), "buyer");
        require(pool.transferToken(token, address(secondBuyer), 2_500 ether), "second buyer");
        require(token.purchasedDuringProtection(address(buyer)) == 2_500 ether, "buyer allocation");
        require(
            token.purchasedDuringProtection(address(secondBuyer)) == 2_500 ether,
            "second allocation"
        );
    }

    function testRejectsPoolTransferBeforeStart() external {
        ProtectedLaunchToken futureToken = _deploy(100);
        futureToken.transfer(address(pool), 800_000 ether);
        futureToken.bindProtectedPool(address(pool), uint64(block.number + 1));
        require(!pool.transferToken(futureToken, address(buyer), 1 ether), "pre-start buy accepted");
    }

    function testCapsStopAfterProtectionWindow() external {
        ProtectedLaunchToken expiredToken = _deploy(1);
        expiredToken.transfer(address(pool), 800_000 ether);
        expiredToken.bindProtectedPool(address(pool), uint64(block.number));
        vm.roll(block.number + 1);
        require(
            pool.transferToken(expiredToken, address(buyer), 100_000 ether),
            "post-window transfer blocked"
        );
        require(
            expiredToken.purchasedDuringProtection(address(buyer)) == 0,
            "post-window allocation recorded"
        );
    }

    function testPoolBindingIsFactoryOnlyAndOneTime() external {
        ProtectedLaunchToken next = _deploy(100);
        require(!buyer.bindPool(next, address(pool), uint64(block.number)), "outsider bound");
        next.bindProtectedPool(address(pool), uint64(block.number));
        (bool rebound,) = address(next)
            .call(
                abi.encodeCall(
                    ProtectedLaunchToken.bindProtectedPool,
                    (address(secondBuyer), uint64(block.number))
                )
            );
        require(!rebound, "pool rebound");
    }

    function testUserTransfersRemainUnrestrictedDuringProtection() external {
        require(pool.transferToken(token, address(buyer), 2_500 ether), "buy");
        require(
            buyer.transferToken(token, address(secondBuyer), 2_500 ether), "user transfer blocked"
        );
        require(
            token.purchasedDuringProtection(address(buyer)) == 2_500 ether,
            "buyer allocation changed"
        );
        require(
            token.purchasedDuringProtection(address(secondBuyer)) == 0, "transfer counted as buy"
        );
    }

    function testDeployerBindsFactoryOnlyOnce() external {
        ProtectedLaunchTokenDeployer deployer = new ProtectedLaunchTokenDeployer(address(this));
        require(!buyer.bindDeployer(deployer, address(buyer)), "outsider bound deployer");
        deployer.bindFactory(address(this));
        (bool rebound,) = address(deployer)
            .call(abi.encodeCall(ProtectedLaunchTokenDeployer.bindFactory, (address(buyer))));
        require(!rebound, "deployer rebound");
    }

    function testHasNoMintTaxBlacklistOrRecipientCallbackSurface() external {
        uint256 supplyBefore = token.totalSupply();
        uint256 poolBefore = token.balanceOf(address(pool));
        uint256 buyerBefore = token.balanceOf(address(buyer));

        require(pool.transferToken(token, address(buyer), 2_500 ether), "exact transfer");
        require(token.totalSupply() == supplyBefore, "supply changed");
        require(token.balanceOf(address(pool)) == poolBefore - 2_500 ether, "sender tax");
        require(
            token.balanceOf(address(buyer)) == buyerBefore + 2_500 ether,
            "recipient tax or callback"
        );

        (bool minted,) = address(token)
            .call(abi.encodeWithSignature("mint(address,uint256)", address(buyer), 1 ether));
        (bool taxed,) = address(token).call(abi.encodeWithSignature("setTax(uint16)", 1));
        (bool blacklisted,) = address(token)
            .call(abi.encodeWithSignature("setBlacklist(address,bool)", address(buyer), true));
        require(!minted && !taxed && !blacklisted, "mutable admin surface found");
    }

    function _deploy(uint32 protectionBlocks) private returns (ProtectedLaunchToken deployed) {
        deployed = new ProtectedLaunchToken(
            "Protected Token",
            "PTKN",
            "ipfs://protected",
            SUPPLY,
            address(this),
            address(this),
            keccak256(abi.encode(address(this), protectionBlocks)),
            1,
            keccak256("POLICY"),
            protectionBlocks,
            25,
            100
        );
    }
}

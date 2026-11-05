// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20Minimal} from "../src/interfaces/IERC20Minimal.sol";
import {BurnModule, IBurnableSupplyToken} from "../src/revenue/BurnModule.sol";

contract BurnGovernanceMock {
    function bind(BurnModule module, address fund) external {
        module.bindAssistanceFund(fund);
    }
}

contract BurnableTokenMock is IBurnableSupplyToken {
    mapping(address account => uint256 amount) private _balances;
    mapping(address owner => mapping(address spender => uint256 amount)) private _allowances;
    uint256 public totalSupply;
    bool private immutable _reduceSupply;

    constructor(bool reduceSupply_) {
        _reduceSupply = reduceSupply_;
    }

    function mint(address recipient, uint256 amount) external {
        _balances[recipient] += amount;
        totalSupply += amount;
    }

    function burn(uint256 amount) external {
        _balances[msg.sender] -= amount;
        if (_reduceSupply) totalSupply -= amount;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function allowance(address owner, address spender) external view returns (uint256) {
        return _allowances[owner][spender];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _allowances[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        _balances[msg.sender] -= amount;
        _balances[recipient] += amount;
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool) {
        _allowances[sender][msg.sender] -= amount;
        _balances[sender] -= amount;
        _balances[recipient] += amount;
        return true;
    }
}

contract AssistanceFundBurnCallerMock {
    function burn(BurnModule module, uint256 amount) external returns (uint256) {
        return module.burn(amount);
    }
}

contract BurnModuleTest {
    function testBurnRequiresBoundFundAndSupplyDelta() external {
        BurnGovernanceMock governance = new BurnGovernanceMock();
        BurnableTokenMock token = new BurnableTokenMock(true);
        BurnModule module = new BurnModule(token, address(governance));
        AssistanceFundBurnCallerMock fund = new AssistanceFundBurnCallerMock();
        governance.bind(module, address(fund));
        token.mint(address(module), 100);

        (bool unauthorized,) = address(module).call(abi.encodeCall(module.burn, (100)));
        require(!unauthorized, "unauthorized burn");
        uint256 supplyAfter = fund.burn(module, 100);
        require(supplyAfter == 0, "supply");
        require(token.balanceOf(address(module)) == 0, "balance");
    }

    function testFakeBurnRevertsAtomically() external {
        BurnGovernanceMock governance = new BurnGovernanceMock();
        BurnableTokenMock token = new BurnableTokenMock(false);
        BurnModule module = new BurnModule(token, address(governance));
        AssistanceFundBurnCallerMock fund = new AssistanceFundBurnCallerMock();
        governance.bind(module, address(fund));
        token.mint(address(module), 100);

        (bool accepted,) = address(fund).call(abi.encodeCall(fund.burn, (module, 100)));
        require(!accepted, "fake burn accepted");
        require(token.balanceOf(address(module)) == 100, "balance not reverted");
        require(token.totalSupply() == 100, "supply changed");
    }

    function testFundBindingIsOneTimeAndTokenIsImmutable() external {
        BurnGovernanceMock governance = new BurnGovernanceMock();
        BurnableTokenMock token = new BurnableTokenMock(true);
        BurnModule module = new BurnModule(token, address(governance));
        AssistanceFundBurnCallerMock fund = new AssistanceFundBurnCallerMock();
        governance.bind(module, address(fund));

        AssistanceFundBurnCallerMock replacement = new AssistanceFundBurnCallerMock();
        (bool rebound,) = address(governance).call(abi.encodeCall(governance.bind, (module, address(replacement))));
        require(!rebound, "fund rebound");
        require(address(module.protocolToken()) == address(token), "token changed");
    }
}

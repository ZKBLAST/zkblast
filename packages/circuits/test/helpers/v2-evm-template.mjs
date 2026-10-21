// Code generation for LOCAL fixed-address fixtures. Not a deployment script.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const numeric = (value) => `uint256(${BigInt(value)})`;
const actionCodes = { swap: 2, "add-liquidity": 3, "remove-liquidity": 4 };

function proofFunction(name, item) {
  const [a, b, c, p] = item.calldata;
  const size = item.circuit === "action" ? 32 : 11;
  if (p.length !== size)
    throw new Error("Unexpected verifier statement length");
  return `function proof_${name}() private pure returns (bytes memory proof, uint256[${size}] memory p) {
    uint256[2] memory a = [${a.map(numeric).join(",")}];
    uint256[2][2] memory b = [[${b[0].map(numeric).join(",")}],[${b[1].map(numeric).join(",")}]];
    uint256[2] memory c = [${c.map(numeric).join(",")}];
    proof = abi.encode(a,b,c);
    ${p.map((value, i) => `p[${i}] = ${numeric(value)};`).join("\n")}
  }`;
}

function termsFunction(name, terms) {
  return `function terms_${name}() private pure returns (SettlementTermsV2.Terms memory t) {
    ${Object.entries(terms)
      .map(([key, value]) => {
        if (key === "action") return `t.action = ${actionCodes[value]};`;
        if (key === "model") return `t.model = ${value === "damm" ? 0 : 1};`;
        return `t.${key} = ${value};`;
      })
      .join("\n")}
  }`;
}

export function renderLocalProofTest(run, cases) {
  if (!/^run-[A-Za-z0-9_-]+$/u.test(run))
    throw new Error("Invalid generated import path");
  return `// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
// GENERATED SYNTHETIC LOCAL FIXTURES ONLY. No broadcast, wallets or real funds.
// etch/store establish deterministic test addresses to bind precomputed proofs.
import {Groth16Verifier as ActionGroth16} from "./ActionGroth16.local.sol";
import {Groth16Verifier as FundGroth16} from "./FundGroth16.local.sol";
import {PrivateVaultV2} from "../../src/privacy/v2/PrivateVaultV2.sol";
import {SettlementTermsV2} from "../../src/privacy/v2/SettlementTermsV2.sol";
import {Poseidon2FieldHasherV2} from "../../src/privacy/v2/Poseidon2FieldHasherV2.sol";
import {PrivateActionVerifierV2,PrivateFundVerifierV2,IActionGroth16V2,IFundGroth16V2} from "../../src/privacy/v2/PrivateProofVerifiersV2.sol";
import {ERC1967Proxy} from "../../src/proxy/ERC1967Proxy.sol";
import {PoolRegistry} from "../../src/core/PoolRegistry.sol";
import {DammPool} from "../../src/core/DammPool.sol";
import {PoolKey,PoolKeyLib,PoolModel} from "../../src/core/PoolTypes.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
interface RealV2Vm { function chainId(uint256) external; function warp(uint256) external; function etch(address,bytes calldata) external; function store(address,bytes32,bytes32) external; }
contract RealPrivateVaultV2LocalTest {
    RealV2Vm private constant vm = RealV2Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    PrivateVaultV2 private vault;
    MockERC20 private token0;
    MockERC20 private token1;
    DammPool private pool;
    address private constant RECIPIENT = address(0x5000);

    function setUp() public {
        vm.chainId(46630); vm.warp(1999999900);
        MockERC20 tokenRuntime = new MockERC20("Local fixture", "FIX");
        vm.etch(address(0x1000),address(tokenRuntime).code);
        vm.etch(address(0x2000),address(tokenRuntime).code);
        token0 = MockERC20(address(0x1000)); token1 = MockERC20(address(0x2000));
        PoolRegistry registry = PoolRegistry(address(new ERC1967Proxy(address(new PoolRegistry()),abi.encodeCall(PoolRegistry.initialize,(address(this),address(this),address(this))))));
        PoolKey memory key = PoolKey(address(token0),address(token1),PoolModel.DAMM,3000,0);
        DammPool poolRuntime = new DammPool(key,address(this));
        vm.etch(address(0x3000),address(poolRuntime).code); pool = DammPool(address(0x3000));
        registry.registerPool(PoolKeyLib.id(key),address(pool),key);
        PrivateActionVerifierV2 action = new PrivateActionVerifierV2(IActionGroth16V2(address(new ActionGroth16())));
        PrivateFundVerifierV2 fund = new PrivateFundVerifierV2(IFundGroth16V2(address(new FundGroth16())));
        PrivateVaultV2 implementation = new PrivateVaultV2();
        ERC1967Proxy proxyRuntime = new ERC1967Proxy(address(implementation),bytes(""));
        vm.etch(address(0x4000),address(proxyRuntime).code);
        vm.store(address(0x4000),0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc,bytes32(uint256(uint160(address(implementation)))));
        vault = PrivateVaultV2(address(0x4000));
        vault.initialize(address(this),address(this),registry,new Poseidon2FieldHasherV2(),action,fund,2);
        vault.setAssetEnabled(address(token0),true); vault.setAssetEnabled(address(token1),true);
        vault.setPaused(false,false,false);
        token0.mint(address(this),200000000); token1.mint(address(this),200000000);
        token0.approve(address(vault),1000000); token1.approve(address(vault),1000000);
    }
    function deposits(bool both) private {
        (bytes memory proof,uint256[11] memory p) = proof_deposit0(); vault.deposit(proof,p);
        if(both) { (proof,p) = proof_deposit1(); vault.deposit(proof,p); }
    }
    function executeAdd() private returns(bytes32 id) {
        (bytes memory proof,uint256[32] memory p) = proof_add();
        SettlementTermsV2.Terms memory t = terms_add();
        id = vault.reserve(t,p,1,proof); vault.settle(id,abi.encode(t,p,uint16(1)));
    }
    function testRealProofLpAddRemoveAndWithdraw() public {
        deposits(true); executeAdd();
        require(pool.sharesOf(address(vault))==999000,"LP shares");
        (bytes memory proof,uint256[32] memory p)=proof_remove();
        SettlementTermsV2.Terms memory t=terms_remove();
        bytes32 id=vault.reserve(t,p,1,proof); vault.settle(id,abi.encode(t,p,uint16(1)));
        (bytes memory wp,uint256[11] memory w)=proof_redeem0(); vault.withdraw(wp,w);
        (wp,w)=proof_redeem1(); vault.withdraw(wp,w);
        require(token0.balanceOf(RECIPIENT)==999000 && token1.balanceOf(RECIPIENT)==999000,"redeem funds");
        require(vault.liabilityRaw(address(token0))==0 && vault.liabilityRaw(address(token1))==0,"token liability");
        require(vault.shareLiability(vault.shareResource(address(pool),0,0))==0,"share liability");
        (bool ok,)=address(vault).call(abi.encodeCall(vault.withdraw,(wp,w))); require(!ok,"withdraw replay");
    }
    function testRealProofExpiredIntentRefundAndWithdraw() public {
        deposits(true);
        (bytes memory proof,uint256[32] memory p)=proof_add();
        SettlementTermsV2.Terms memory t=terms_add(); bytes32 id=vault.reserve(t,p,1,proof);
        (bytes memory oldProof,uint256[11] memory oldNote)=proof_originalWithdraw0();
        (bool accepted,)=address(vault).call(abi.encodeCall(vault.withdraw,(oldProof,oldNote)));
        require(!accepted,"reserved original note spent");
        vault.setPaused(true,true,false); vm.warp(uint256(t.deadline)+1); vault.refund(id);
        (accepted,)=address(vault).call(abi.encodeCall(vault.withdraw,(oldProof,oldNote)));
        require(!accepted,"refunded original note revived");
        (bytes memory wp,uint256[11] memory w)=proof_refund0(); vault.withdraw(wp,w);
        (wp,w)=proof_refund1(); vault.withdraw(wp,w);
        require(token0.balanceOf(RECIPIENT)==1000000 && token1.balanceOf(RECIPIENT)==1000000,"refund funds");
        require(vault.liabilityRaw(address(token0))==0 && vault.liabilityRaw(address(token1))==0,"refund liability");
        require(pool.totalShares()==0,"refund moved pool");
    }
    function testRealProofSwapAndWithdraw() public {
        token0.approve(address(pool),100000000); token1.approve(address(pool),100000000);
        pool.addLiquidity(100000000,100000000,1,address(this),type(uint256).max);
        deposits(false);
        (bytes memory proof,uint256[32] memory p)=proof_swap();
        SettlementTermsV2.Terms memory t=terms_swap(); bytes32 id=vault.reserve(t,p,1,proof);
        vault.settle(id,abi.encode(t,p,uint16(1)));
        (bytes memory wp,uint256[11] memory w)=proof_swapWithdraw(); vault.withdraw(wp,w);
        require(token1.balanceOf(RECIPIENT)==${cases.swapWithdraw.publicSignals[8]},"swap output");
        require(vault.liabilityRaw(address(token0))==0 && vault.liabilityRaw(address(token1))==0,"swap liability");
    }
    function testRealVerifiersRejectAlteredPublicInputsAndMalformedProof() public view {
        (bytes memory ap,uint256[32] memory a)=proof_add(); a[1]=4663;
        require(!vault.actionVerifier().verify(ap,a),"changed action network");
        (bytes memory fp,uint256[11] memory f)=proof_deposit0(); f[0]=1;
        require(!vault.fundVerifier().verify(fp,f),"v1 schema accepted");
        require(!vault.fundVerifier().verify(hex"1234",f),"malformed proof accepted");
    }
    ${Object.entries(cases)
      .map(([name, item]) => proofFunction(name, item))
      .join("\n")}
    ${Object.entries(cases)
      .filter(([, item]) => item.terms)
      .map(([name, item]) => termsFunction(name, item.terms))
      .join("\n")}
}
`;
}

export async function writeLocalProofTest(run, directory, release, cases) {
  const generated = path.resolve(
    import.meta.dirname,
    "../../../contracts/test/generated-v2-local",
  );
  await mkdir(generated, { recursive: true });
  for (const [circuit, name] of [
    ["action", "ActionGroth16.local.sol"],
    ["fund", "FundGroth16.local.sol"],
  ]) {
    const source = await readFile(
      path.join(directory, `${circuit}-verifier.sol`),
    );
    const hash = createHash("sha256").update(source).digest("hex");
    if (hash !== release.artifacts[circuit].solidityVerifierSha256)
      throw new Error("Verifier source hash mismatch");
    await writeFile(path.join(generated, name), source);
  }
  await writeFile(
    path.join(generated, "RealPrivateVaultV2.local.t.sol"),
    renderLocalProofTest(run, cases),
  );
}

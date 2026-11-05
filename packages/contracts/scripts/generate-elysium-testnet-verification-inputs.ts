import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Address } from "viem";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "../../..");
const contractsRoot = path.join(root, "packages/contracts");
const directory = path.join(root, "deployments/elysium-testnet/verification-inputs");
const forge = process.env.FORGE_BIN ?? "/private/tmp/zkblast-foundry/forge";
const readPlan = async (relativePath: string) => JSON.parse(await readFile(path.join(root, "deployments/elysium-testnet", relativePath), "utf8")) as { addresses: Record<string, Address> };
const [dbc, launchpad, protectedLaunch] = await Promise.all([
  readPlan("dbc-deployment-plan.json"),
  readPlan("launchpad-deployment-plan.json"),
  readPlan("protected-launch/deployment-plan.json"),
]);
const entries = [
  ["dbc-launch-config-registry", dbc.addresses.configRegistryImplementation, "src/dbc/LaunchConfigRegistry.sol:LaunchConfigRegistry"],
  ["dbc-launch-token-deployer", dbc.addresses.launchTokenDeployer, "src/dbc/LaunchTokenDeployer.sol:LaunchTokenDeployer"],
  ["dbc-virtual-pool-deployer", dbc.addresses.virtualPoolDeployer, "src/dbc/VirtualPoolDeployer.sol:VirtualPoolDeployer"],
  ["dbc-launch-factory", dbc.addresses.launchFactoryImplementation, "src/dbc/LaunchFactory.sol:LaunchFactory"],
  ["dbc-launchpad-router", dbc.addresses.launchpadRouterImplementation, "src/dbc/LaunchpadRouter.sol:LaunchpadRouter"],
  ["dbc-lp-allocation-escrow", dbc.addresses.lpAllocationEscrowImplementation, "src/dbc/LPAllocationEscrow.sol:LPAllocationEscrow"],
  ["dbc-graduation-manager", dbc.addresses.graduationManagerImplementation, "src/dbc/GraduationManager.sol:GraduationManager"],
  ["dbc-curve-quoter", dbc.addresses.curveQuoter, "src/dbc/CurveQuoter.sol:CurveQuoter"],
  ["launchpad-registry", launchpad.addresses.registryImplementation, "src/launchpad/LaunchpadRegistry.sol:LaunchpadRegistry"],
  ["launchpad-config-manager", launchpad.addresses.configManagerImplementation, "src/launchpad/LaunchpadConfigManager.sol:LaunchpadConfigManager"],
  ["launchpad-factory", launchpad.addresses.factoryImplementation, "src/launchpad/LaunchpadFactory.sol:LaunchpadFactory"],
  ["launchpad-fee-controller", launchpad.addresses.feeControllerImplementation, "src/launchpad/LaunchpadFeeController.sol:LaunchpadFeeController"],
  ["launchpad-revenue-splitter", launchpad.addresses.revenueSplitterImplementation, "src/launchpad/RevenueSplitter.sol:RevenueSplitter"],
  ["launchpad-fee-collector", launchpad.addresses.feeCollectorImplementation, "src/launchpad/LaunchpadFeeCollector.sol:LaunchpadFeeCollector"],
  ["launchpad-token-factory", launchpad.addresses.tokenFactoryImplementation, "src/launchpad/LaunchpadTokenFactory.sol:LaunchpadTokenFactory"],
  ["launchpad-lens", launchpad.addresses.lens, "src/launchpad/LaunchpadLens.sol:LaunchpadLens"],
  ["protected-policy-registry", protectedLaunch.addresses.policyRegistryImplementation, "src/launchpad/protection/LaunchProtectionPolicyRegistry.sol:LaunchProtectionPolicyRegistry"],
  ["protected-lp-escrow", protectedLaunch.addresses.lpEscrowImplementation, "src/launchpad/protection/ProtectedLPAllocationEscrow.sol:ProtectedLPAllocationEscrow"],
  ["protected-identity-registry", protectedLaunch.addresses.identityRegistryImplementation, "src/launchpad/protection/ProtectedLaunchIdentityRegistry.sol:ProtectedLaunchIdentityRegistry"],
  ["protected-token-deployer", protectedLaunch.addresses.tokenDeployer, "src/launchpad/protection/ProtectedLaunchTokenDeployer.sol:ProtectedLaunchTokenDeployer"],
  ["protected-pool-deployer", protectedLaunch.addresses.virtualPoolDeployer, "src/launchpad/protection/ProtectedVirtualPoolDeployer.sol:ProtectedVirtualPoolDeployer"],
  ["protected-factory", protectedLaunch.addresses.factoryImplementation, "src/launchpad/protection/ProtectedLaunchFactory.sol:ProtectedLaunchFactory"],
  ["protected-router", protectedLaunch.addresses.routerImplementation, "src/launchpad/protection/ProtectedLaunchRouter.sol:ProtectedLaunchRouter"],
  ["protected-graduation-manager", protectedLaunch.addresses.graduationManagerImplementation, "src/dbc/ProtectedGraduationManager.sol:ProtectedGraduationManager"],
] as const;
await mkdir(directory, { recursive: true });
const index: Array<Record<string, unknown>> = [];
for (const [name, address, contract] of entries) {
  const { stdout } = await execFileAsync(forge, ["verify-contract", address, contract, "--chain-id", "99801", "--show-standard-json-input"], { cwd: contractsRoot, env: { ...process.env, FOUNDRY_PROFILE: "elysium" }, maxBuffer: 20 * 1024 * 1024 });
  const parsed = JSON.parse(stdout) as Record<string, unknown>;
  const canonical = `${JSON.stringify(parsed, null, 2)}\n`;
  const file = `${name}.standard-input.json`;
  await writeFile(path.join(directory, file), canonical, { mode: 0o644 });
  index.push({ name, address, contract, compiler: "0.8.26", file, sha256: createHash("sha256").update(canonical).digest("hex") });
}
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), chainId: 99_801, compiler: "0.8.26", profile: "elysium", inputCount: index.length, published: false, entries: index };
await writeFile(path.join(directory, "index.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify({ inputCount: report.inputCount, compiler: report.compiler, directory, published: false }, null, 2));

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { getAddress, parseAbi, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
export const implementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export const accessAbi = parseAbi([
  "function hasRole(bytes32,address) view returns (bool)",
  "function setRole(bytes32,address,bool)",
  "function registry() view returns (address)",
  "function poolCount() view returns (uint256)",
  "function permissionlessCreation() view returns (bool)",
]);
export const timelockAbi = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function hasRole(bytes32,address) view returns (bool)",
  "function schedule(address,uint256,bytes,bytes32,bytes32,uint256)",
  "function execute(address,uint256,bytes,bytes32,bytes32) payable returns (bytes)",
  "function getTimestamp(bytes32) view returns (uint256)",
  "function isOperationDone(bytes32) view returns (bool)",
]);
export type Artifact = {
  abi: Abi;
  bytecode: { object: Hex };
  deployedBytecode: {
    object: Hex;
    immutableReferences?: Record<string, { start: number; length: number }[]>;
  };
};
export function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}
export async function save(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(`${file}.tmp`, file);
}
export async function artifact(name: string) {
  return readJson<Artifact>(
    path.join(root, `packages/contracts/out/${name}.sol/${name}.json`),
  );
}
export function runtimeFor(build: Artifact, address: Address): Hex {
  let code = build.deployedBytecode.object.slice(2);
  for (const entries of Object.values(
    build.deployedBytecode.immutableReferences ?? {},
  )) {
    for (const { start, length } of entries) {
      check(length === 32, "UNEXPECTED_IMMUTABLE_LAYOUT");
      code =
        code.slice(0, start * 2) +
        address.slice(2).toLowerCase().padStart(64, "0") +
        code.slice((start + length) * 2);
    }
  }
  return `0x${code}`;
}
export async function loadSameWallets() {
  if (!process.argv.includes("--same-wallets")) return;
  const secrets = parseEnv(
    await readFile(path.join(root, ".env.testnet"), "utf8"),
  );
  for (const name of [
    "DEPLOYER_PRIVATE_KEY",
    "GOVERNANCE_PRIVATE_KEY",
    "UPGRADER_PRIVATE_KEY",
  ]) {
    if (!process.env[name]?.trim()) process.env[name] = secrets[name];
  }
}
export function accountFor(name: string, expected: Address) {
  const value = process.env[name]?.trim();
  check(value && /^0x[\da-f]{64}$/iu.test(value), `INVALID_${name}`);
  const account = privateKeyToAccount(value as Hex);
  check(account.address === getAddress(expected), `MISMATCH_${name}`);
  return account;
}

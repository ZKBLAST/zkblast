import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Abi, Hex } from "viem";

type Artifact = Readonly<{
  abi: Abi;
  bytecode: { object: Hex };
  deployedBytecode: { object: Hex };
}>;

const artifactRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../out",
);
const upgradeableContracts = [
  "PoolRegistry",
  "PoolFactory",
  "SwapRouter",
  "PositionManager",
] as const;
const directContracts = ["PoolQuoter", "ERC1967Proxy"] as const;

async function readArtifact(name: string): Promise<Artifact> {
  const location = path.join(artifactRoot, `${name}.sol`, `${name}.json`);
  return JSON.parse(await readFile(location, "utf8")) as Artifact;
}

function assertDeployable(name: string, value: Artifact): void {
  if (!value.bytecode.object || value.bytecode.object === "0x") {
    throw new Error(`${name}: creation bytecode is empty`);
  }
  if (
    !value.deployedBytecode.object ||
    value.deployedBytecode.object === "0x"
  ) {
    throw new Error(`${name}: runtime bytecode is empty`);
  }
}

for (const name of [...upgradeableContracts, ...directContracts]) {
  const value = await readArtifact(name);
  assertDeployable(name, value);
  if (
    upgradeableContracts.includes(
      name as (typeof upgradeableContracts)[number],
    ) &&
    !value.abi.some(
      (item) => item.type === "function" && item.name === "initialize",
    )
  ) {
    throw new Error(`${name}: initialize function is missing`);
  }
}

console.log(
  `Deployment artifacts ready: ${upgradeableContracts.length + directContracts.length}`,
);

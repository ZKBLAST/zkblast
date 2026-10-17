import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const contractRoot = path.resolve(packageRoot, "../contracts/out");
const outputPath = path.resolve(packageRoot, "src/generated.ts");
const contracts = [
  ["poolRegistryAbi", "PoolRegistry"],
  ["poolFactoryAbi", "PoolFactory"],
  ["dammPoolAbi", "DammPool"],
  ["dlmmPoolAbi", "DlmmPool"],
  ["poolQuoterAbi", "PoolQuoter"],
  ["swapRouterAbi", "SwapRouter"],
  ["positionManagerAbi", "PositionManager"],
  ["erc20Abi", "IERC20Minimal"],
];

const sections = await Promise.all(
  contracts.map(async ([exportName, contractName]) => {
    const artifactPath = path.join(
      contractRoot,
      `${contractName}.sol`,
      `${contractName}.json`,
    );
    const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
    if (!Array.isArray(artifact.abi))
      throw new Error(`${contractName}: ABI missing`);
    return `export const ${exportName} = ${JSON.stringify(artifact.abi, null, 2)} as const;`;
  }),
);
const output = await format(
  [
    "// Generated from Foundry artifacts. Do not edit by hand.",
    ...sections,
    "",
  ].join("\n\n"),
  { parser: "typescript" },
);

if (process.argv.includes("--check")) {
  const existing = await readFile(outputPath, "utf8").catch(() => "");
  if (existing !== output)
    throw new Error("Generated ABIs are stale; run pnpm abi:generate");
  console.log(`Generated ABI check passed: ${contracts.length} contracts`);
} else {
  await writeFile(outputPath, output);
  console.log(`Generated ABIs: ${contracts.length} contracts`);
}

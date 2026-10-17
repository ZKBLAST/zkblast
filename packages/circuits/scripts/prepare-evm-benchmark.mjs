import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const packageRoot = path.resolve(import.meta.dirname, "..");
const projectRoot = path.join(packageRoot, "target", "evm-benchmark");

await rm(projectRoot, { force: true, recursive: true });
await mkdir(path.join(projectRoot, "src"), { recursive: true });
await Promise.all([
  cp(
    path.join(packageRoot, "target/noir/Verifier.sol"),
    path.join(projectRoot, "src/NoirVerifier.sol"),
  ),
  cp(
    path.join(packageRoot, "target/circom/Verifier.sol"),
    path.join(projectRoot, "src/CircomVerifier.sol"),
  ),
]);
const noirVerifierPath = path.join(projectRoot, "src/NoirVerifier.sol");
const noirVerifier = await readFile(noirVerifierPath, "utf8");
await writeFile(
  noirVerifierPath,
  noirVerifier
    .replace("pragma solidity ^0.8.27;", "pragma solidity >=0.8.21;")
    .replaceAll("assembly {", 'assembly ("memory-safe") {'),
);
await writeFile(
  path.join(projectRoot, "foundry.toml"),
  `[profile.default]\nsolc_version = "0.8.26"\nsrc = "src"\nout = "out"\noptimizer = true\noptimizer_runs = 200\nvia_ir = true\nbytecode_hash = "none"\n`,
);
console.log(projectRoot);

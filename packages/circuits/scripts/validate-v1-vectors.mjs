import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, "..");
const generator = path.join(
  packageRoot,
  "target/v1-withdraw/withdraw_js/generate_witness.js",
);
const wasm = path.join(
  packageRoot,
  "target/v1-withdraw/withdraw_js/withdraw.wasm",
);
const validPath = path.join(packageRoot, "vectors/v1/withdraw-valid.json");
const valid = JSON.parse(await readFile(validPath, "utf8"));
const target = path.join(packageRoot, "target/v1-withdraw");

async function expectValid(name, input) {
  const inputPath = path.join(target, `${name}.json`);
  await writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`);
  await run(process.execPath, [
    generator,
    wasm,
    inputPath,
    path.join(target, `${name}.wtns`),
  ]);
}

async function expectInvalid(name, mutate) {
  const input = structuredClone(valid);
  mutate(input);
  try {
    await expectValid(name, input);
  } catch {
    return;
  }
  throw new Error(`NEGATIVE_VECTOR_ACCEPTED:${name}`);
}

await expectValid("valid", valid);
await expectInvalid("wrong-root", (input) => {
  input.merkle_root = "1";
});
await expectInvalid("wrong-nullifier", (input) => {
  input.nullifier = "1";
});
await expectInvalid("wrong-action", (input) => {
  input.action = "2";
});
await expectInvalid("non-boolean-direction", (input) => {
  input.path_directions[0] = "2";
});
await expectInvalid("index-path-mismatch", (input) => {
  input.leaf_index = "0";
});
await expectInvalid("fee-exceeds-amount", (input) => {
  input.relayer_fee = "1000000000000000001";
});

console.log("Withdrawal v1 vectors passed: 1 positive, 6 negative");

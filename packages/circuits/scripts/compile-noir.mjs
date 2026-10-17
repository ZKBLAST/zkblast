import { compile, createFileManager } from "@noir-lang/noir_wasm";
import { Noir } from "@noir-lang/noir_js";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const project = new URL("../candidates/noir/", import.meta.url);
const target = new URL("../target/noir/", import.meta.url);
await mkdir(target, { recursive: true });
const compiled = await compile(createFileManager(fileURLToPath(project)));
if (!compiled.program)
  throw new Error(compiled.diagnostics.map((item) => item.message).join("\n"));
await writeFile(
  new URL("circuit.json", target),
  `${JSON.stringify(compiled.program)}\n`,
);
const siblings = Array.from({ length: 32 }, (_, index) => String(index + 2));
const directions = Array.from({ length: 32 }, () => false);
let current = 1n;
for (let index = 0; index < 32; index += 1) {
  const value = current + BigInt(index + 2) * 7n + BigInt(index);
  current = value ** 5n;
  current %=
    21888242871839275222246405745257275088548364400416034343698204186575808495617n;
}
const modulus =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const nullifier = 124n ** 5n % modulus;
const noir = new Noir(compiled.program);
const { witness } = await noir.execute({
  root: current.toString(),
  nullifier: nullifier.toString(),
  secret: "1",
  siblings,
  directions,
});
await writeFile(new URL("witness.gz", target), witness);
await writeFile(
  new URL("input.json", target),
  `${JSON.stringify({ root: current.toString(), nullifier: nullifier.toString(), secret: "1", siblings, directions }, null, 2)}\n`,
);
console.log("Noir candidate compiled and witness generated");

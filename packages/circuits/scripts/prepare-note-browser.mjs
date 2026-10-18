import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const packageRoot = path.resolve(import.meta.dirname, "..");
const webAssetRoot = path.resolve(packageRoot, "../../apps/web/public/zk");
const wasmPath = path.join(
  packageRoot,
  "target/v1-vector/vector-generator_js/vector-generator.wasm",
);
const calculatorPath = path.join(
  packageRoot,
  "target/v1-vector/vector-generator_js/witness_calculator.js",
);

const buildWitnessCalculator = (await import(calculatorPath)).default;
const calculator = await buildWitnessCalculator(await readFile(wasmPath));
const vector = JSON.parse(
  await readFile(path.join(packageRoot, "vectors/v1/base-input.json"), "utf8"),
);
const manifest = JSON.parse(
  await readFile(path.join(packageRoot, "vectors/v1/manifest.json"), "utf8"),
);
const witness = await calculator.calculateWitness(vector, 0);
const actual = {
  commitment: witness[1].toString(),
  merkleRoot: witness[2].toString(),
  nullifier: witness[3].toString(),
};
if (
  actual.commitment !== manifest.expected.commitment ||
  actual.merkleRoot !== manifest.expected.merkleRoot ||
  actual.nullifier !== manifest.expected.nullifier
) {
  throw new Error("NOTE_BROWSER_VECTOR_MISMATCH");
}

await mkdir(webAssetRoot, { recursive: true });
await copyFile(wasmPath, path.join(webAssetRoot, "note-vector.wasm"));
await build({
  entryPoints: [path.join(packageRoot, "browser/note-worker.js")],
  outfile: path.join(webAssetRoot, "note-worker.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
});
console.log("Browser note circuit prepared and matched the frozen v1 vector");

import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, "..");
const compiler = path.join(packageRoot, "node_modules/.bin/circom2");
const targets = [
  ["src/v1/vector-generator.circom", "target/v1-vector"],
  ["src/v1/withdraw.circom", "target/v1-withdraw"],
];

for (const [source, output] of targets) {
  await mkdir(path.join(packageRoot, output), { recursive: true });
  const { stdout } = await run(
    compiler,
    [
      path.join(packageRoot, source),
      "--r1cs",
      "--wasm",
      "--sym",
      "-o",
      path.join(packageRoot, output),
    ],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  process.stdout.write(stdout);
}

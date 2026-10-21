import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const run = JSON.parse(
  await readFile(path.join(root, "target/v2-testnet/last-run.json"), "utf8"),
);
const runPath = run.run ? path.join("target/v2-testnet", run.run) : undefined;
if (!runPath) throw new Error("V2_RUN_DIRECTORY_MISSING");
const directory = await realpath(path.resolve(root, runPath));
const target = await realpath(path.join(root, "target/v2-testnet"));
if (!directory.startsWith(`${target}${path.sep}`))
  throw new Error("V2_RUN_OUTSIDE_TARGET");
const calculator = path.join(
  directory,
  "spend-vector_js/witness_calculator.js",
);
await build({
  entryPoints: [path.join(root, "browser/private-v2-note-worker.js")],
  outfile: path.resolve(
    root,
    "../../apps/web/public/zk/private-v2-note-worker.js",
  ),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  plugins: [
    {
      name: "v2-calculator",
      setup(builder) {
        builder.onResolve({ filter: /^zkblast-v2-calculator$/ }, () => ({
          path: calculator,
        }));
        builder.onLoad(
          { filter: /witness_calculator\.js$/ },
          async ({ path: filename }) => {
            if (filename !== calculator) return;
            const source = await readFile(filename, "utf8");
            const assignment = /^(\s*)a = flatArray\(input\);$/gmu;
            if ([...source.matchAll(assignment)].length !== 1)
              throw new Error("V2_CALCULATOR_GENERATOR_CHANGED");
            return {
              contents: source.replace(
                assignment,
                "$1let a = flatArray(input);",
              ),
              loader: "js",
            };
          },
        );
      },
    },
  ],
});
console.log(
  "Built isolated v2 note worker; no keys, manifests or deployment settings changed",
);

import { readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const calculator = path.join(root, "target/perps-v1-candidate-5/position-vector/witness_calculator.js");
await build({
  entryPoints: [path.join(root, "browser/perps-position-worker.js")],
  outfile: path.resolve(root, "../../apps/web/public/zk/perps-position-worker.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  plugins: [{
    name: "perps-position-calculator",
    setup(builder) {
      builder.onResolve({ filter: /^zkblast-v2-calculator$/ }, () => ({ path: calculator }));
      builder.onLoad({ filter: /witness_calculator\.js$/ }, async ({ path: filename }) => {
        if (filename !== calculator) return;
        const source = await readFile(filename, "utf8");
        const assignment = /^(\s*)a = flatArray\(input\);$/gmu;
        if ([...source.matchAll(assignment)].length !== 1)
          throw new Error("PERPS_POSITION_CALCULATOR_GENERATOR_CHANGED");
        return { contents: source.replace(assignment, "$1let a = flatArray(input);"), loader: "js" };
      });
    },
  }],
});
console.log("Built hash-scoped private Perps position worker");

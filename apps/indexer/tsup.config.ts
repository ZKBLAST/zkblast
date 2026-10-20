import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/runner.ts", "src/run-market-chart-sync.ts"],
  format: ["esm"],
  clean: true,
  noExternal: [/^@zkblast\//u],
});

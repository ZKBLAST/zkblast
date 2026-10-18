import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/runner.ts"],
  format: ["esm"],
  clean: true,
  noExternal: [/^@zkblast\//u],
});

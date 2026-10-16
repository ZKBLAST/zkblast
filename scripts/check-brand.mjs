import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  "node_modules",
  "dist",
  "out",
  "coverage",
]);
const allowedFiles = new Set([
  "docs/DEVELOPMENT_ROADMAP.md",
  "docs/ZKBLAST_DEVELOPER_BRIEF.md",
  "scripts/check-brand.mjs",
]);
const forbidden = /quanta(?:-pools)?/iu;
const findings = [];

async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;

    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(root, absolutePath);

    if (entry.isDirectory()) {
      await scan(absolutePath);
      continue;
    }

    if (allowedFiles.has(relativePath) || relativePath.startsWith(".env."))
      continue;

    const content = await readFile(absolutePath, "utf8").catch(() => null);
    if (
      content !== null &&
      (forbidden.test(relativePath) || forbidden.test(content))
    ) {
      findings.push(relativePath);
    }
  }
}

await scan(root);

if (findings.length > 0) {
  throw new Error(`Forbidden legacy brand found in: ${findings.join(", ")}`);
}

console.log("Legacy-brand scan passed");

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const sourceRoot = path.resolve("apps/web/src");
const checkedDirectories = [
  "app",
  "components",
  "features",
  "lib",
  "styles",
  "types",
];
const maximumLines = 350;
const maximumStylesheetLines = 550;
const violations = [];

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? collectFiles(target) : [target];
    }),
  );
  return nested.flat();
}

for (const directory of checkedDirectories) {
  const files = await collectFiles(path.join(sourceRoot, directory));
  for (const file of files.filter((target) => /\.(css|ts|tsx)$/.test(target))) {
    const source = await readFile(file, "utf8");
    const relative = path.relative(process.cwd(), file);
    const lines = source.split("\n").length;

    const lineLimit = file.endsWith(".css")
      ? maximumStylesheetLines
      : maximumLines;
    if (lines > lineLimit) {
      violations.push(`${relative}: ${lines} lines exceeds ${lineLimit}`);
    }
    if (relative.includes(`${path.sep}features${path.sep}`)) {
      for (const primitive of ["AppLink", "Badge", "Panel"]) {
        if (source.includes(`function ${primitive}(`)) {
          violations.push(`${relative}: duplicates shared ${primitive}`);
        }
      }
    }
    if (file.endsWith("dashboard.tsx") && source.includes("await fetch(")) {
      violations.push(`${relative}: bypasses the shared API client`);
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("Web architecture boundaries passed");

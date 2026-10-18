import { readdir, readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const mainnetCommand = packageJson.scripts?.["db:seed:mainnet"];
if (mainnetCommand !== "node scripts/refuse-database-seed.mjs mainnet") {
  throw new Error("Mainnet seed command must be the explicit refusal guard");
}

const mainnetFiles = await readdir("supabase/migrations/mainnet");
if (mainnetFiles.some((name) => /seed/iu.test(name))) {
  throw new Error("Mainnet seed migration detected");
}

const testnetCommand = packageJson.scripts?.["db:seed:testnet"];
if (!testnetCommand?.includes("scripts/register-testnet-market.mjs")) {
  throw new Error("Testnet seed must use the validated deployment manifest");
}

console.log("Database seed policy checks passed");

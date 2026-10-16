import { access, readFile } from "node:fs/promises";
import process from "node:process";

const environment = process.env.APP_ENV;
if (environment !== "testnet" && environment !== "mainnet") {
  throw new Error("APP_ENV must be explicitly set to testnet or mainnet");
}

const envPath = `.env.${environment}`;
await access(envPath).catch(() => {
  throw new Error(`${envPath} is missing; copy its .example file first`);
});

const file = await readFile(envPath, "utf8");
const entries = new Map(
  file
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");
      return separator < 0
        ? [line, ""]
        : [line.slice(0, separator), line.slice(separator + 1)];
    }),
);

const required = [
  "APP_ENV",
  "CHAIN_ID",
  "CHAIN_NAME",
  "RPC_URL",
  "BLOCK_EXPLORER_URL",
  "DEPLOYMENT_MANIFEST_PATH",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SCHEMA",
];
const missing = required.filter((key) => !entries.get(key));

if (entries.get("APP_ENV") !== environment) {
  throw new Error(`${envPath}: APP_ENV must equal ${environment}`);
}

const expectedSchema = `zkblast_${environment}`;
if (entries.get("SUPABASE_SCHEMA") !== expectedSchema) {
  throw new Error(`${envPath}: SUPABASE_SCHEMA must equal ${expectedSchema}`);
}

const expectedManifest = `deployments/${environment}/manifest.json`;
if (entries.get("DEPLOYMENT_MANIFEST_PATH") !== expectedManifest) {
  throw new Error(
    `${envPath}: DEPLOYMENT_MANIFEST_PATH must equal ${expectedManifest}`,
  );
}

if (missing.length > 0) {
  throw new Error(`${envPath}: missing values for ${missing.join(", ")}`);
}

console.log(`${envPath} passed environment validation`);

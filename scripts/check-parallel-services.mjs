import { readFile } from "node:fs/promises";

const matrix = JSON.parse(
  await readFile("deploy/railway-services.json", "utf8"),
);
const services = matrix.services;
const assert = (value, message) => {
  if (!value) throw new Error(message);
};

assert(matrix.protocol === "ZKBLAST", "Invalid deployment matrix identity");
assert(services.length === 6, "Exactly six parallel services are required");
assert(
  new Set(services.map((service) => service.name)).size === services.length,
  "Service names must be unique",
);

for (const environment of ["testnet", "mainnet"]) {
  const expectedChainId = environment === "testnet" ? "46630" : "4663";
  const expectedSchema = `zkblast_${environment}`;
  const expectedManifest = `deployments/${environment}/manifest.json`;
  const source = await readFile(`.env.${environment}`, "utf8");
  const values = new Map(
    source
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
  assert(
    values.get("APP_ENV") === environment,
    `${environment}: APP_ENV mismatch`,
  );
  assert(
    values.get("CHAIN_ID") === expectedChainId,
    `${environment}: CHAIN_ID mismatch`,
  );
  assert(
    values.get("SUPABASE_SCHEMA") === expectedSchema,
    `${environment}: schema mismatch`,
  );
  assert(
    values.get("DEPLOYMENT_MANIFEST_PATH") === expectedManifest,
    `${environment}: manifest path mismatch`,
  );
}

for (const service of services) {
  assert(
    ["web", "api", "indexer"].includes(service.kind),
    `${service.name}: invalid service kind`,
  );
  assert(
    service.name === `${service.kind}-${service.environment}`,
    `${service.name}: identity mismatch`,
  );
  assert(
    service.buildCommand.startsWith("pnpm --filter @zkblast/"),
    `${service.name}: unsafe build command`,
  );
  assert(
    service.startCommand.startsWith("pnpm --filter @zkblast/"),
    `${service.name}: unsafe start command`,
  );
  if (service.kind === "web") {
    assert(
      service.requiredVariables.length === 1 &&
        service.requiredVariables[0] === "API_URL",
      `${service.name}: web may receive only API_URL`,
    );
  }
  for (const variable of service.requiredVariables)
    assert(
      !service.forbiddenVariables.includes(variable),
      `${service.name}: ${variable} is both required and forbidden`,
    );
}

console.log(
  "Parallel service boundaries passed: 6 services, 2 isolated networks",
);

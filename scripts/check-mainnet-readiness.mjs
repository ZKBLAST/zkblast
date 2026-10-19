import { access, readFile } from "node:fs/promises";
import process from "node:process";

const checks = [];
const record = (name, passed, detail) =>
  checks.push({ name, status: passed ? "pass" : "blocked", detail });
const exists = async (path) =>
  access(path)
    .then(() => true)
    .catch(() => false);
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

record(
  "environment",
  process.env.APP_ENV === "mainnet",
  "APP_ENV must be mainnet",
);
record("chain", process.env.CHAIN_ID === "4663", "CHAIN_ID must be 4663");
record(
  "database-schema",
  process.env.SUPABASE_SCHEMA === "zkblast_mainnet",
  "SUPABASE_SCHEMA must be zkblast_mainnet",
);

const requiredValues = [
  "RPC_URL",
  "WS_RPC_URL",
  "BLOCK_EXPLORER_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DIRECT_DATABASE_URL",
  "DEPLOYER_PRIVATE_KEY",
  "GOVERNANCE_MULTISIG_ADDRESS",
  "PROXY_ADMIN_ADDRESS",
  "EXECUTION_WETH_ADDRESS",
  "EXECUTION_USDG_ADDRESS",
];
const missingValues = requiredValues.filter(
  (name) => !process.env[name]?.trim(),
);
record(
  "configuration",
  missingValues.length === 0,
  missingValues.length === 0
    ? "required server-side values are present"
    : `missing: ${missingValues.join(", ")}`,
);

const requiredDocuments = [
  "docs/DEPLOYMENTS.md",
  "docs/MIGRATION_PLAN.md",
  "docs/DATABASE_RUNBOOK.md",
  "docs/INCIDENT_RESPONSE.md",
  "docs/RELEASE_CHECKLIST.md",
];
const missingDocuments = [];
for (const path of requiredDocuments)
  if (!(await exists(path))) missingDocuments.push(path);
record(
  "runbooks",
  missingDocuments.length === 0,
  missingDocuments.length === 0
    ? "all mandatory runbooks exist"
    : `missing: ${missingDocuments.join(", ")}`,
);

const manifestPath = "deployments/mainnet/manifest.json";
let manifestValid = false;
if (await exists(manifestPath)) {
  try {
    const manifest = await readJson(manifestPath);
    manifestValid =
      manifest.protocol === "ZKBLAST" &&
      manifest.environment === "mainnet" &&
      manifest.chainId === 4663;
  } catch {
    manifestValid = false;
  }
}
record(
  "deployment-manifest",
  manifestValid,
  "reviewed mainnet manifest is required",
);

let auditApproved = false;
const auditPath = "audit-artifacts/mainnet/approval.json";
if (await exists(auditPath)) {
  try {
    const audit = await readJson(auditPath);
    auditApproved =
      audit.protocol === "ZKBLAST" &&
      audit.approved === true &&
      audit.unresolvedCritical === 0 &&
      audit.unresolvedHigh === 0 &&
      Array.isArray(audit.auditors) &&
      audit.auditors.length > 0;
  } catch {
    auditApproved = false;
  }
}
record(
  "independent-audit",
  auditApproved,
  "independent approval with zero unresolved critical/high findings is required",
);

let rehearsalPassed = false;
const rehearsalPath = "evidence/mainnet/recovery-rehearsal.json";
if (await exists(rehearsalPath)) {
  try {
    const rehearsal = await readJson(rehearsalPath);
    rehearsalPassed =
      rehearsal.protocol === "ZKBLAST" &&
      rehearsal.environment === "mainnet" &&
      rehearsal.passed === true;
  } catch {
    rehearsalPassed = false;
  }
}
record(
  "recovery-rehearsal",
  rehearsalPassed,
  "approved incident, pause, rotation, rollback, and recovery rehearsal is required",
);

const passed = checks.filter((check) => check.status === "pass").length;
const result = {
  ready: passed === checks.length,
  passed,
  total: checks.length,
  checks,
};
console.log(JSON.stringify(result, null, 2));
if (!result.ready) process.exitCode = 1;

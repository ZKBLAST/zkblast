import { readFile } from "node:fs/promises";

const envFiles = [".env.testnet", ".env.mainnet"];
const allowedPublicKeys = new Set(["NEXT_PUBLIC_API_URL"]);
const privateKeys = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DIRECT_DATABASE_URL",
  "DEPLOYER_PRIVATE_KEY",
  "UPGRADER_PRIVATE_KEY",
  "DATABASE_URL",
  "WS_RPC_URL",
  "OPERATIONS_API_TOKEN",
];

function parseEnv(content) {
  return new Map(
    content
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
}

for (const envFile of envFiles) {
  const entries = parseEnv(await readFile(envFile, "utf8"));
  const publicEntries = [...entries].filter(([key]) =>
    key.startsWith("NEXT_PUBLIC_"),
  );
  const invalidNames = publicEntries
    .map(([key]) => key)
    .filter((key) => !allowedPublicKeys.has(key));

  if (invalidNames.length > 0) {
    throw new Error(
      `${envFile}: only NEXT_PUBLIC_API_URL may be public; remove ${invalidNames.join(", ")}`,
    );
  }

  for (const privateKey of privateKeys) {
    const privateValue = entries.get(privateKey);
    if (!privateValue) continue;

    const leakedAs = publicEntries.find(
      ([, value]) => value === privateValue,
    )?.[0];
    if (leakedAs) {
      throw new Error(
        `${envFile}: ${privateKey} duplicates public value ${leakedAs}`,
      );
    }
  }
}

console.log("Environment public/private boundary scan passed");

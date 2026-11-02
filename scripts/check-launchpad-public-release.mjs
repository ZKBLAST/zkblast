import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const tracked=execFileSync("git",["ls-files","-z"],{ encoding:"utf8" }).split("\0").filter(Boolean);
const forbiddenFiles=[/(^|\/)\.env\.(testnet|mainnet|local)$/u,/\.(pem|p12|keystore)$/u,/(^|\/)docs\/evidence\//u,/broadcast\//u];
const browserFiles=tracked.filter((file)=>file.startsWith("apps/web/")||file.startsWith("examples/launchpad-starter/"));
const forbiddenBrowser=[/NEXT_PUBLIC_[A-Z0-9_]*(?:PRIVATE|SECRET|DATABASE|SUPABASE|RPC)/u,/SUPABASE_(?:SERVICE|DIRECT)_/u,/(?:DEPLOYER|GOVERNANCE|UPGRADER)_PRIVATE_KEY/u,/postgres(?:ql)?:\/\//u,/alchemy\.com\/v2\/[A-Za-z0-9_-]{8,}/u];
const violations=[];
for (const file of tracked) if (forbiddenFiles.some((pattern)=>pattern.test(file))) violations.push({ rule:"private-file",file });
for (const file of browserFiles) {
  const bytes=await readFile(file);
  if (bytes.includes(0)) continue;
  const text=bytes.toString("utf8");
  for (const pattern of forbiddenBrowser) if (pattern.test(text)) violations.push({ rule:"browser-secret-boundary",file });
}
const environmentTemplates=tracked.filter((file)=>/^\.env\..+\.example$/u.test(file));
for (const file of environmentTemplates) {
  const lines=(await readFile(file,"utf8")).split(/\r?\n/u);
  for (const line of lines) {
    if (!line||line.startsWith("#")) continue;
    const separator=line.indexOf("=");
    if (separator<=0) continue;
    const key=line.slice(0,separator).trim();
    const value=line.slice(separator+1).trim();
    if (/(?:PRIVATE_KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|SUPABASE_.*KEY|RPC_URL|ENCRYPTION_KEY)$/u.test(key)&&value!=="") violations.push({ rule:"committed-sensitive-env-value",file });
  }
}
if (violations.length) {
  console.error(JSON.stringify({ status:"failed",violations },null,2));
  process.exit(1);
}
console.log(JSON.stringify({ status:"passed",trackedFiles:tracked.length,browserFiles:browserFiles.length,environmentTemplates:environmentTemplates.length,publicProvingKeys:tracked.filter((file)=>file.endsWith(".zkey")).length }));

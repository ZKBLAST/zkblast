import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";

export const launchpadApiScopes = ["launchpads:read","launches:read","trades:read","fees:read","webhooks:read","webhooks:write"] as const;
export const launchpadWebhookEvents = ["launchpad.created","launchpad.updated","token.launched","trade.executed","fee.accrued","fee.claimed","graduation.ready","graduation.completed","graduation.failed"] as const;
export type LaunchpadApiScope = (typeof launchpadApiScopes)[number];
export type LaunchpadWebhookEvent = (typeof launchpadWebhookEvents)[number];

export function createApiCredential() {
  const prefix = `zkb_${randomBytes(6).toString("hex")}`;
  const secret = randomBytes(32).toString("base64url");
  const salt = randomBytes(16).toString("hex");
  return { prefix, secret: `${prefix}.${secret}`, salt, hash: scryptSync(secret,salt,32).toString("hex") };
}
export function verifyApiCredential(value: string,salt: string,expectedHash: string) {
  const secret = value.split(".")[1];
  if (!secret || !/^[0-9a-f]{32}$/u.test(salt) || !/^[0-9a-f]{64}$/u.test(expectedHash)) return false;
  const actual = scryptSync(secret,salt,32);
  return timingSafeEqual(actual,Buffer.from(expectedHash,"hex"));
}

export function encryptWebhookSecret(secret: string,key: Buffer) {
  if (key.length !== 32) throw new Error("LAUNCHPAD_WEBHOOK_KEY_INVALID");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm",key,iv);
  const ciphertext = Buffer.concat([cipher.update(secret,"utf8"),cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}
export function decryptWebhookSecret(input: { ciphertext: string; iv: string; tag: string },key: Buffer) {
  if (key.length !== 32) throw new Error("LAUNCHPAD_WEBHOOK_KEY_INVALID");
  const decipher = createDecipheriv("aes-256-gcm",key,Buffer.from(input.iv,"base64"));
  decipher.setAuthTag(Buffer.from(input.tag,"base64"));
  return Buffer.concat([decipher.update(Buffer.from(input.ciphertext,"base64")),decipher.final()]).toString("utf8");
}

function privateAddress(address: string) {
  if (isIP(address) === 4) {
    const [a,b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168) || a! >= 224;
  }
  const value = address.toLowerCase();
  return value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb") || value.startsWith("::ffff:");
}
async function webhookTarget(raw: string,resolve: (hostname: string) => Promise<readonly string[]>) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password || url.hash)
    throw new Error("LAUNCHPAD_WEBHOOK_URL_INVALID");
  const hostname = url.hostname.toLowerCase().replace(/\.$/u,"");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal"))
    throw new Error("LAUNCHPAD_WEBHOOK_SSRF_BLOCKED");
  const addresses = isIP(hostname) ? [hostname] : await resolve(hostname);
  if (!addresses.length || addresses.some(privateAddress)) throw new Error("LAUNCHPAD_WEBHOOK_SSRF_BLOCKED");
  return { url: url.toString(),hostname,addresses };
}
export async function validateWebhookUrl(raw: string,resolve: (hostname: string) => Promise<readonly string[]>) { return (await webhookTarget(raw,resolve)).url; }
export async function probeWebhookOwnership(raw: string,token: string,resolve: (hostname: string) => Promise<readonly string[]>) {
  const target = await webhookTarget(raw,resolve);
  const address = target.addresses[0]!;
  const family = isIP(address);
  return new Promise<boolean>((resolveProbe,reject) => {
    const request = httpsRequest(target.url,{
      method: "POST", servername: target.hostname, timeout: 5_000,
      headers: { "content-type": "application/json", "user-agent": "ZKBLAST-Webhook-Verification/1" },
      lookup: (_hostname,_options,callback) => callback(null,address,family),
    },(response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data",(chunk: Buffer) => { size += chunk.length; if (size > 4096) request.destroy(new Error("LAUNCHPAD_WEBHOOK_RESPONSE_TOO_LARGE")); else chunks.push(chunk); });
      response.on("end",() => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { challenge?: string };
          resolveProbe(response.statusCode === 200 && body.challenge === token);
        } catch { resolveProbe(false); }
      });
    });
    request.on("timeout",() => request.destroy(new Error("LAUNCHPAD_WEBHOOK_VERIFICATION_TIMEOUT")));
    request.on("error",reject);
    request.end(JSON.stringify({ schemaVersion: 1,type: "webhook.verification",challenge: token }));
  });
}

export function webhookEnvelope(event: { id: string; type: LaunchpadWebhookEvent; createdAt: string; data: unknown },secret: string) {
  const body = JSON.stringify({ schemaVersion: 1, ...event });
  const timestamp = Math.floor(Date.now()/1000).toString();
  const signature = createHmac("sha256",secret).update(`v1.${timestamp}.${body}`).digest("hex");
  return { body, headers: { "content-type": "application/json", "x-zkblast-event-id": event.id, "x-zkblast-timestamp": timestamp, "x-zkblast-signature": `v1=${signature}` } };
}
export function webhookRetry(attempts: number,now = Date.now()) {
  const delays = [60,300,1800,7200,21600];
  return attempts >= delays.length ? { status: "dead_letter" as const, nextAttemptAt: null } : { status: "failed" as const, nextAttemptAt: new Date(now + delays[attempts]! * 1000) };
}
export const developerDetailHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class ApiKeyRateGuard {
  readonly #buckets = new Map<string, { count: number; resetsAt: number }>();
  constructor(private readonly limit = 60,private readonly windowMs = 60_000) {}
  consume(prefix: string,now = Date.now()) {
    const current = this.#buckets.get(prefix);
    const bucket = !current || current.resetsAt <= now ? { count: 0,resetsAt: now + this.windowMs } : current;
    bucket.count += 1;
    this.#buckets.set(prefix,bucket);
    return { allowed: bucket.count <= this.limit,remaining: Math.max(0,this.limit-bucket.count),resetsAt: bucket.resetsAt };
  }
}

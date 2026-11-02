import { createHash, randomBytes } from "node:crypto";
import { getAddress, recoverMessageAddress, type Address, type Hex } from "viem";
import { createApiCredential, encryptWebhookSecret, launchpadApiScopes, launchpadWebhookEvents, validateWebhookUrl, verifyApiCredential, type LaunchpadApiScope, type LaunchpadWebhookEvent } from "./launchpad-developer-security.js";
import type { PostgresLaunchpadDeveloperStore } from "./postgres-launchpad-developer-store.js";

export type DeveloperAuthorization = Readonly<{ ownerAddress: string; signature: Hex; signedAt: string }>;
export interface DeveloperOwnershipReader { owner(launchpadId: bigint): Promise<Address>; }
export interface WebhookOwnershipProbe { verify(url: string,token: string): Promise<boolean>; }

export class LaunchpadDeveloperService {
  constructor(
    private readonly chainId: number,
    private readonly store: PostgresLaunchpadDeveloperStore,
    private readonly ownership: DeveloperOwnershipReader,
    private readonly resolveHost: (hostname: string) => Promise<readonly string[]>,
    private readonly probe: WebhookOwnershipProbe,
    private readonly encryptionKey: Buffer,
  ) {}
  private async authorize(launchpadId: string,action: string,detail: unknown,auth: DeveloperAuthorization) {
    const signedAt = new Date(auth.signedAt);
    if (!Number.isFinite(signedAt.getTime()) || Math.abs(Date.now()-signedAt.getTime())>15*60_000) throw new Error("LAUNCHPAD_DEVELOPER_SIGNATURE_EXPIRED");
    const detailHash = createHash("sha256").update(JSON.stringify(detail)).digest("hex");
    const message = ["ZKBLAST Launchpad Developer Action",`Chain ID: ${this.chainId}`,`Launchpad ID: ${launchpadId}`,`Action: ${action}`,`Detail Hash: ${detailHash}`,`Signed At: ${signedAt.toISOString()}`].join("\n");
    const signer = await recoverMessageAddress({ message,signature: auth.signature });
    const requested = getAddress(auth.ownerAddress);
    if (signer !== requested || requested !== getAddress(await this.ownership.owner(BigInt(launchpadId)))) throw new Error("LAUNCHPAD_DEVELOPER_OWNER_INVALID");
    return requested;
  }
  async createKey(launchpadId: string,input: { name: string; scopes: readonly LaunchpadApiScope[] },auth: DeveloperAuthorization) {
    if (!input.scopes.length || input.scopes.some((scope) => !launchpadApiScopes.includes(scope))) throw new Error("LAUNCHPAD_API_SCOPE_INVALID");
    const actor = await this.authorize(launchpadId,"api_key.create",input,auth);
    const credential = createApiCredential();
    const keyId = await this.store.createKey({ launchpadId,name: input.name,prefix: credential.prefix,salt: credential.salt,hash: credential.hash,scopes: [...new Set(input.scopes)],actor });
    return { keyId,prefix: credential.prefix,secret: credential.secret,scopes: input.scopes,displayOnce: true };
  }
  async rotateKey(launchpadId: string,keyId: string,auth: DeveloperAuthorization) {
    const actor = await this.authorize(launchpadId,"api_key.rotate",{ keyId },auth);
    const credential = createApiCredential();
    await this.store.rotateKey({ launchpadId,keyId,prefix: credential.prefix,salt: credential.salt,hash: credential.hash,actor });
    return { keyId,prefix: credential.prefix,secret: credential.secret,displayOnce: true };
  }
  async revokeKey(launchpadId: string,keyId: string,auth: DeveloperAuthorization) { const actor=await this.authorize(launchpadId,"api_key.revoke",{ keyId },auth); await this.store.revokeKey({ launchpadId,keyId,actor }); }
  listKeys(launchpadId: string) { return this.store.listKeys(launchpadId); }
  async registerWebhook(launchpadId: string,input: { url: string; eventTypes: readonly LaunchpadWebhookEvent[] },auth: DeveloperAuthorization) {
    if (!input.eventTypes.length || input.eventTypes.some((event) => !launchpadWebhookEvents.includes(event))) throw new Error("LAUNCHPAD_WEBHOOK_EVENT_INVALID");
    const url = await validateWebhookUrl(input.url,this.resolveHost);
    const actor = await this.authorize(launchpadId,"webhook.create",{ url,eventTypes: input.eventTypes },auth);
    const signingSecret = randomBytes(32).toString("base64url");
    const verificationToken = randomBytes(32).toString("base64url");
    const encrypted = encryptWebhookSecret(signingSecret,this.encryptionKey);
    const endpointId = await this.store.createWebhook({ launchpadId,url,eventTypes: [...new Set(input.eventTypes)],...encrypted,tokenHash: createHash("sha256").update(verificationToken).digest("hex"),expiresAt: new Date(Date.now()+30*60_000),actor });
    return { endpointId,url,eventTypes: input.eventTypes,signingSecret,verificationToken,displayOnce: true };
  }
  async verifyWebhook(launchpadId: string,endpointId: string,verificationToken: string,auth: DeveloperAuthorization) {
    const actor = await this.authorize(launchpadId,"webhook.verify",{ endpointId },auth);
    const endpoint = await this.store.endpoint(launchpadId,endpointId) as { url?: string; verification_token_hash?: string; verification_expires_at?: Date } | null;
    if (!endpoint?.url || !endpoint.verification_token_hash || !endpoint.verification_expires_at || endpoint.verification_expires_at <= new Date()) throw new Error("LAUNCHPAD_WEBHOOK_VERIFICATION_INVALID");
    const hash = createHash("sha256").update(verificationToken).digest("hex");
    if (hash !== endpoint.verification_token_hash || !(await this.probe.verify(await validateWebhookUrl(endpoint.url,this.resolveHost),verificationToken))) throw new Error("LAUNCHPAD_WEBHOOK_VERIFICATION_INVALID");
    await this.store.activateWebhook(launchpadId,endpointId,actor);
  }
  listWebhooks(launchpadId: string) { return this.store.listWebhooks(launchpadId); }
  async retryDelivery(launchpadId: string,deliveryId: string,auth: DeveloperAuthorization) { const actor=await this.authorize(launchpadId,"webhook.delivery.retry",{ deliveryId },auth); await this.store.manualRetry(launchpadId,deliveryId,actor); }
  async snapshot(launchpadId: string,auth: DeveloperAuthorization) {
    await this.authorize(launchpadId,"developer.snapshot",{},auth);
    const [apiKeys,webhooks,deliveries] = await Promise.all([this.store.listKeys(launchpadId),this.store.listWebhooks(launchpadId),this.store.listDeliveries(launchpadId)]);
    return { apiKeys,webhooks,deliveries };
  }
  async authenticateApiKey(value: string,scope: LaunchpadApiScope) {
    const prefix = value.split(".")[0] ?? "";
    const record = await this.store.apiKey(prefix);
    if (!record || record.status !== "active" || !record.scopes.includes(scope) || !verifyApiCredential(value,record.secret_salt,record.secret_hash)) throw new Error("LAUNCHPAD_API_KEY_INVALID");
    return { keyId: record.key_id,launchpadId: record.launchpad_id,prefix: record.key_prefix,scopes: record.scopes };
  }
  recordApiKeyUse(keyId: string,rateLimited: boolean) { return this.store.recordApiKeyUse(keyId,rateLimited); }
}

import postgres from "postgres";
import type { Address } from "viem";

const schemaPattern = /^zkblast_(testnet|mainnet)$/u;
export class PostgresLaunchpadDeveloperStore {
  readonly #sql;
  constructor(databaseUrl: string,readonly schema: string) {
    if (!schemaPattern.test(schema)) throw new Error("INVALID_DATABASE_SCHEMA");
    this.#sql = postgres(databaseUrl,{ max: 2,prepare: false,idle_timeout: 10 });
  }
  async createKey(input: { launchpadId: string; name: string; prefix: string; salt: string; hash: string; scopes: readonly string[]; actor: Address }) {
    return this.#sql.begin(async (tx) => {
      const rows = await tx.unsafe<{ key_id: string }[]>(`insert into ${this.schema}.launchpad_api_keys(launchpad_id,name,key_prefix,secret_salt,secret_hash,scopes) values($1,$2,$3,$4,$5,$6) returning key_id`,[input.launchpadId,input.name,input.prefix,input.salt,input.hash,input.scopes]);
      await this.audit(tx,input.launchpadId,input.actor,"api_key.created",rows[0]!.key_id,{ name: input.name,scopes: input.scopes,prefix: input.prefix });
      return rows[0]!.key_id;
    });
  }
  async rotateKey(input: { launchpadId: string; keyId: string; prefix: string; salt: string; hash: string; actor: Address }) {
    return this.#sql.begin(async (tx) => {
      const rows = await tx.unsafe(`update ${this.schema}.launchpad_api_keys set key_prefix=$3,secret_salt=$4,secret_hash=$5,rotated_at=now(),last_used_at=null where launchpad_id=$1 and key_id=$2 and status='active' returning key_id`,[input.launchpadId,input.keyId,input.prefix,input.salt,input.hash]);
      if (!rows.length) throw new Error("LAUNCHPAD_API_KEY_NOT_FOUND");
      await this.audit(tx,input.launchpadId,input.actor,"api_key.rotated",input.keyId,{ prefix: input.prefix });
    });
  }
  async revokeKey(input: { launchpadId: string; keyId: string; actor: Address }) {
    return this.#sql.begin(async (tx) => {
      const rows = await tx.unsafe(`update ${this.schema}.launchpad_api_keys set status='revoked',revoked_at=coalesce(revoked_at,now()) where launchpad_id=$1 and key_id=$2 returning key_id`,[input.launchpadId,input.keyId]);
      if (!rows.length) throw new Error("LAUNCHPAD_API_KEY_NOT_FOUND");
      await this.audit(tx,input.launchpadId,input.actor,"api_key.revoked",input.keyId,{});
    });
  }
  listKeys(launchpadId: string) {
    return this.#sql.unsafe(`select key_id,name,key_prefix,scopes,status,created_at,rotated_at,revoked_at,last_used_at from ${this.schema}.launchpad_api_keys where launchpad_id=$1 order by created_at desc`,[launchpadId]);
  }
  async apiKey(prefix: string) {
    const rows = await this.#sql.unsafe<{ key_id: string; launchpad_id: string; key_prefix: string; secret_salt: string; secret_hash: string; scopes: string[]; status: string }[]>(`select key_id,launchpad_id::text,key_prefix,secret_salt,secret_hash,scopes,status from ${this.schema}.launchpad_api_keys where key_prefix=$1 limit 1`,[prefix]);
    return rows[0] ?? null;
  }
  recordApiKeyUse(keyId: string,rateLimited: boolean) { return this.#sql.unsafe(`update ${this.schema}.launchpad_api_keys set last_used_at=now(),request_count=request_count+1,last_rate_limited_at=case when $2 then now() else last_rate_limited_at end where key_id=$1`,[keyId,rateLimited]); }
  async createWebhook(input: { launchpadId: string; url: string; eventTypes: readonly string[]; ciphertext: string; iv: string; tag: string; tokenHash: string; expiresAt: Date; actor: Address }) {
    return this.#sql.begin(async (tx) => {
      const rows = await tx.unsafe<{ endpoint_id: string }[]>(`insert into ${this.schema}.launchpad_webhook_endpoints(launchpad_id,url,event_types,secret_ciphertext,secret_iv,secret_tag,verification_token_hash,verification_expires_at) values($1,$2,$3,$4,$5,$6,$7,$8) returning endpoint_id`,[input.launchpadId,input.url,input.eventTypes,input.ciphertext,input.iv,input.tag,input.tokenHash,input.expiresAt]);
      await this.audit(tx,input.launchpadId,input.actor,"webhook.created",rows[0]!.endpoint_id,{ url: input.url,eventTypes: input.eventTypes });
      return rows[0]!.endpoint_id;
    });
  }
  async endpoint(launchpadId: string,endpointId: string) {
    const rows = await this.#sql.unsafe<Record<string,unknown>[]>(`select * from ${this.schema}.launchpad_webhook_endpoints where launchpad_id=$1 and endpoint_id=$2 limit 1`,[launchpadId,endpointId]);
    return rows[0] ?? null;
  }
  async activateWebhook(launchpadId: string,endpointId: string,actor: Address) {
    await this.#sql.begin(async (tx) => {
      const rows = await tx.unsafe(`update ${this.schema}.launchpad_webhook_endpoints set status='active',verified_at=now(),updated_at=now() where launchpad_id=$1 and endpoint_id=$2 and status='pending_verification' and verification_expires_at>now() returning endpoint_id`,[launchpadId,endpointId]);
      if (!rows.length) throw new Error("LAUNCHPAD_WEBHOOK_VERIFICATION_INVALID");
      await this.audit(tx,launchpadId,actor,"webhook.verified",endpointId,{});
    });
  }
  async manualRetry(launchpadId: string,deliveryId: string,actor: Address) {
    await this.#sql.begin(async (tx) => {
      const rows = await tx.unsafe(`update ${this.schema}.launchpad_webhook_deliveries d set status='pending',next_attempt_at=now(),updated_at=now() from ${this.schema}.launchpad_webhook_endpoints e where d.endpoint_id=e.endpoint_id and e.launchpad_id=$1 and d.delivery_id=$2 and d.status in ('failed','dead_letter') returning d.delivery_id`,[launchpadId,deliveryId]);
      if (!rows.length) throw new Error("LAUNCHPAD_WEBHOOK_DELIVERY_NOT_RETRYABLE");
      await this.audit(tx,launchpadId,actor,"webhook.delivery_retried",deliveryId,{});
    });
  }
  listWebhooks(launchpadId: string) { return this.#sql.unsafe(`select endpoint_id,url,event_types,status,verification_expires_at,verified_at,created_at,updated_at from ${this.schema}.launchpad_webhook_endpoints where launchpad_id=$1 order by created_at desc`,[launchpadId]); }
  listDeliveries(launchpadId: string) { return this.#sql.unsafe(`select d.delivery_id,d.event_id,d.event_type,d.status,d.attempts,d.next_attempt_at,d.delivered_at,d.last_error_code,d.created_at from ${this.schema}.launchpad_webhook_deliveries d join ${this.schema}.launchpad_webhook_endpoints e on e.endpoint_id=d.endpoint_id where e.launchpad_id=$1 order by d.created_at desc limit 100`,[launchpadId]); }
  private async audit(tx: postgres.TransactionSql,launchpadId: string,actor: Address,action: string,targetId: string,detail: unknown) {
    const { developerDetailHash } = await import("./launchpad-developer-security.js");
    await tx.unsafe(`insert into ${this.schema}.launchpad_developer_audit_log(launchpad_id,actor_address,action,target_id,detail_hash) values($1,$2,$3,$4,$5)`,[launchpadId,actor.toLowerCase(),action,targetId,developerDetailHash(detail)]);
  }
}

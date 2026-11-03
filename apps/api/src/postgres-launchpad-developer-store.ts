import postgres from "postgres";
import { isSupportedDatabaseSchema } from "@zkblast/config";
import type { Address } from "viem";

export class PostgresLaunchpadDeveloperStore {
  readonly #sql;
  constructor(databaseUrl: string,readonly schema: string,readonly chainId: number) {
    if (!isSupportedDatabaseSchema(schema)) throw new Error("INVALID_DATABASE_SCHEMA");
    this.#sql = postgres(databaseUrl,{ max: 2,prepare: false,idle_timeout: 10 });
  }
  async createKey(input: { launchpadId: string; name: string; prefix: string; salt: string; hash: string; scopes: readonly string[]; actor: Address }) {
    return this.#sql.begin(async (tx) => {
      const rows = await tx.unsafe<{ key_id: string }[]>(`insert into ${this.schema}.launchpad_api_keys(chain_id,launchpad_id,name,key_prefix,secret_salt,secret_hash,scopes) values($1,$2,$3,$4,$5,$6,$7) returning key_id`,[this.chainId,input.launchpadId,input.name,input.prefix,input.salt,input.hash,input.scopes]);
      await this.audit(tx,input.launchpadId,input.actor,"api_key.created",rows[0]!.key_id,{ name: input.name,scopes: input.scopes,prefix: input.prefix });
      return rows[0]!.key_id;
    });
  }
  async rotateKey(input: { launchpadId: string; keyId: string; prefix: string; salt: string; hash: string; actor: Address }) {
    return this.#sql.begin(async (tx) => {
      const rows = await tx.unsafe(`update ${this.schema}.launchpad_api_keys set key_prefix=$4,secret_salt=$5,secret_hash=$6,rotated_at=now(),last_used_at=null where chain_id=$1 and launchpad_id=$2 and key_id=$3 and status='active' returning key_id`,[this.chainId,input.launchpadId,input.keyId,input.prefix,input.salt,input.hash]);
      if (!rows.length) throw new Error("LAUNCHPAD_API_KEY_NOT_FOUND");
      await this.audit(tx,input.launchpadId,input.actor,"api_key.rotated",input.keyId,{ prefix: input.prefix });
    });
  }
  async revokeKey(input: { launchpadId: string; keyId: string; actor: Address }) {
    return this.#sql.begin(async (tx) => {
      const rows = await tx.unsafe(`update ${this.schema}.launchpad_api_keys set status='revoked',revoked_at=coalesce(revoked_at,now()) where chain_id=$1 and launchpad_id=$2 and key_id=$3 returning key_id`,[this.chainId,input.launchpadId,input.keyId]);
      if (!rows.length) throw new Error("LAUNCHPAD_API_KEY_NOT_FOUND");
      await this.audit(tx,input.launchpadId,input.actor,"api_key.revoked",input.keyId,{});
    });
  }
  listKeys(launchpadId: string) {
    return this.#sql.unsafe(`select key_id,name,key_prefix,scopes,status,created_at,rotated_at,revoked_at,last_used_at from ${this.schema}.launchpad_api_keys where chain_id=$1 and launchpad_id=$2 order by created_at desc`,[this.chainId,launchpadId]);
  }
  async apiKey(prefix: string) {
    const rows = await this.#sql.unsafe<{ key_id: string; launchpad_id: string; key_prefix: string; secret_salt: string; secret_hash: string; scopes: string[]; status: string }[]>(`select key_id,launchpad_id::text,key_prefix,secret_salt,secret_hash,scopes,status from ${this.schema}.launchpad_api_keys where chain_id=$1 and key_prefix=$2 limit 1`,[this.chainId,prefix]);
    return rows[0] ?? null;
  }
  recordApiKeyUse(keyId: string,rateLimited: boolean) { return this.#sql.unsafe(`update ${this.schema}.launchpad_api_keys set last_used_at=now(),request_count=request_count+1,last_rate_limited_at=case when $3 then now() else last_rate_limited_at end where chain_id=$1 and key_id=$2`,[this.chainId,keyId,rateLimited]); }
  async createWebhook(input: { launchpadId: string; url: string; eventTypes: readonly string[]; ciphertext: string; iv: string; tag: string; tokenHash: string; expiresAt: Date; actor: Address }) {
    return this.#sql.begin(async (tx) => {
      const rows = await tx.unsafe<{ endpoint_id: string }[]>(`insert into ${this.schema}.launchpad_webhook_endpoints(chain_id,launchpad_id,url,event_types,secret_ciphertext,secret_iv,secret_tag,verification_token_hash,verification_expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning endpoint_id`,[this.chainId,input.launchpadId,input.url,input.eventTypes,input.ciphertext,input.iv,input.tag,input.tokenHash,input.expiresAt]);
      await this.audit(tx,input.launchpadId,input.actor,"webhook.created",rows[0]!.endpoint_id,{ url: input.url,eventTypes: input.eventTypes });
      return rows[0]!.endpoint_id;
    });
  }
  async endpoint(launchpadId: string,endpointId: string) {
    const rows = await this.#sql.unsafe<Record<string,unknown>[]>(`select * from ${this.schema}.launchpad_webhook_endpoints where chain_id=$1 and launchpad_id=$2 and endpoint_id=$3 limit 1`,[this.chainId,launchpadId,endpointId]);
    return rows[0] ?? null;
  }
  async activateWebhook(launchpadId: string,endpointId: string,actor: Address) {
    await this.#sql.begin(async (tx) => {
      const rows = await tx.unsafe(`update ${this.schema}.launchpad_webhook_endpoints set status='active',verified_at=now(),updated_at=now() where chain_id=$1 and launchpad_id=$2 and endpoint_id=$3 and status='pending_verification' and verification_expires_at>now() returning endpoint_id`,[this.chainId,launchpadId,endpointId]);
      if (!rows.length) throw new Error("LAUNCHPAD_WEBHOOK_VERIFICATION_INVALID");
      await this.audit(tx,launchpadId,actor,"webhook.verified",endpointId,{});
    });
  }
  async manualRetry(launchpadId: string,deliveryId: string,actor: Address) {
    await this.#sql.begin(async (tx) => {
      const rows = await tx.unsafe(`update ${this.schema}.launchpad_webhook_deliveries d set status='pending',next_attempt_at=now(),updated_at=now() from ${this.schema}.launchpad_webhook_endpoints e where d.chain_id=$1 and e.chain_id=$1 and d.endpoint_id=e.endpoint_id and e.launchpad_id=$2 and d.delivery_id=$3 and d.status in ('failed','dead_letter') returning d.delivery_id`,[this.chainId,launchpadId,deliveryId]);
      if (!rows.length) throw new Error("LAUNCHPAD_WEBHOOK_DELIVERY_NOT_RETRYABLE");
      await this.audit(tx,launchpadId,actor,"webhook.delivery_retried",deliveryId,{});
    });
  }
  listWebhooks(launchpadId: string) { return this.#sql.unsafe(`select endpoint_id,url,event_types,status,verification_expires_at,verified_at,created_at,updated_at from ${this.schema}.launchpad_webhook_endpoints where chain_id=$1 and launchpad_id=$2 order by created_at desc`,[this.chainId,launchpadId]); }
  listDeliveries(launchpadId: string) { return this.#sql.unsafe(`select d.delivery_id,d.event_id,d.event_type,d.status,d.attempts,d.next_attempt_at,d.delivered_at,d.last_error_code,d.created_at from ${this.schema}.launchpad_webhook_deliveries d join ${this.schema}.launchpad_webhook_endpoints e on e.chain_id=d.chain_id and e.endpoint_id=d.endpoint_id where e.chain_id=$1 and e.launchpad_id=$2 order by d.created_at desc limit 100`,[this.chainId,launchpadId]); }
  private async audit(tx: postgres.TransactionSql,launchpadId: string,actor: Address,action: string,targetId: string,detail: unknown) {
    const { developerDetailHash } = await import("./launchpad-developer-security.js");
    await tx.unsafe(`insert into ${this.schema}.launchpad_developer_audit_log(chain_id,launchpad_id,actor_address,action,target_id,detail_hash) values($1,$2,$3,$4,$5,$6)`,[this.chainId,launchpadId,actor.toLowerCase(),action,targetId,developerDetailHash(detail)]);
  }
}

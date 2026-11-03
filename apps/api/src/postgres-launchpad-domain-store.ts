import postgres from "postgres";
import { isSupportedDatabaseSchema } from "@zkblast/config";
import type {
  LaunchpadDomainRecord,
  LaunchpadDomainStore,
} from "./launchpad-domain-service.js";

type DomainRow = Readonly<{
  domain_id: string; launchpad_id: string; hostname: string;
  status: LaunchpadDomainRecord["status"]; challenge_hash: string;
  challenge_expires_at: Date; verified_at: Date | null; revoked_at: Date | null;
}>;
const map = (row: DomainRow): LaunchpadDomainRecord => ({
  domainId: row.domain_id,
  launchpadId: row.launchpad_id,
  hostname: row.hostname,
  status: row.status,
  challengeHash: row.challenge_hash,
  challengeExpiresAt: row.challenge_expires_at,
  verifiedAt: row.verified_at,
  revokedAt: row.revoked_at,
});

export class PostgresLaunchpadDomainStore implements LaunchpadDomainStore {
  readonly #sql;
  constructor(databaseUrl: string, private readonly schema: string, private readonly chainId: number) {
    if (!isSupportedDatabaseSchema(schema)) throw new Error("INVALID_DATABASE_SCHEMA");
    this.#sql = postgres(databaseUrl, { max: 2, prepare: false, idle_timeout: 10 });
  }
  async issue(input: Readonly<{ launchpadId: string; hostname: string; challengeHash: string; challengeExpiresAt: Date }>) {
    return this.#sql.begin(async (transaction) => {
      const existing = await transaction.unsafe<DomainRow[]>(
        `select domain_id,launchpad_id::text,hostname,status,challenge_hash,challenge_expires_at,verified_at,revoked_at
         from ${this.schema}.launchpad_domains where chain_id=$1 and hostname=$2 for update`, [this.chainId,input.hostname],
      );
      if (existing[0] && existing[0].launchpad_id !== input.launchpadId)
        throw new Error("LAUNCHPAD_DOMAIN_TAKEN");
      if (existing[0]?.status === "verified") throw new Error("LAUNCHPAD_DOMAIN_ALREADY_VERIFIED");
      const rows = await transaction.unsafe<DomainRow[]>(
        `insert into ${this.schema}.launchpad_domains(chain_id,launchpad_id,hostname,status,challenge_hash,challenge_expires_at,verified_at,revoked_at,updated_at)
         values($1,$2,$3,'pending',$4,$5,null,null,now())
         on conflict(hostname) do update set status='pending',challenge_hash=excluded.challenge_hash,
         challenge_expires_at=excluded.challenge_expires_at,verified_at=null,revoked_at=null,updated_at=now()
         returning domain_id,launchpad_id::text,hostname,status,challenge_hash,challenge_expires_at,verified_at,revoked_at`,
        [this.chainId,input.launchpadId,input.hostname,input.challengeHash,input.challengeExpiresAt],
      );
      return map(rows[0]!);
    });
  }
  async domain(domainId: string) {
    const rows = await this.#sql.unsafe<DomainRow[]>(
      `select domain_id,launchpad_id::text,hostname,status,challenge_hash,challenge_expires_at,verified_at,revoked_at
       from ${this.schema}.launchpad_domains where chain_id=$1 and domain_id=$2 limit 1`, [this.chainId,domainId],
    );
    return rows[0] ? map(rows[0]) : null;
  }
  async markVerified(domainId: string, verifiedAt: Date) {
    await this.#sql.unsafe(
      `update ${this.schema}.launchpad_domains set status='verified',verified_at=$3,revoked_at=null,updated_at=now()
       where chain_id=$1 and domain_id=$2 and status in ('pending','expired')`, [this.chainId,domainId,verifiedAt],
    );
  }
  async markRevoked(domainId: string, revokedAt: Date) {
    await this.#sql.unsafe(
      `update ${this.schema}.launchpad_domains set status='revoked',revoked_at=$3,verified_at=null,updated_at=now()
       where chain_id=$1 and domain_id=$2`, [this.chainId,domainId,revokedAt],
    );
  }
}

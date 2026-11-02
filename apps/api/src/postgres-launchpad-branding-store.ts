import postgres from "postgres";
import type {
  LaunchpadBrandingStore,
  StoredLaunchpadBranding,
} from "./launchpad-branding-service.js";

const schemaPattern = /^zkblast_(testnet|mainnet)$/u;

export class PostgresLaunchpadBrandingStore implements LaunchpadBrandingStore {
  readonly #sql;

  constructor(databaseUrl: string, private readonly schema: string) {
    if (!schemaPattern.test(schema)) throw new Error("INVALID_DATABASE_SCHEMA");
    this.#sql = postgres(databaseUrl, { max: 2, prepare: false, idle_timeout: 10 });
  }

  async save(input: StoredLaunchpadBranding): Promise<void> {
    await this.#sql.begin(async (transaction) => {
      const current = await transaction.unsafe<{ current_version: number; slug: string; metadata_hash: string; signature: string | null }[]>(
        `select p.current_version,p.slug,p.metadata_hash,v.signature from ${this.schema}.launchpad_profiles p
         left join ${this.schema}.launchpad_branding_versions v on v.launchpad_id=p.launchpad_id and v.version=p.current_version
         where p.launchpad_id=$1 for update`,
        [input.branding.launchpadId],
      );
      if (
        current[0]?.current_version === input.version
        && current[0].metadata_hash === input.metadataHash.toLowerCase()
        && current[0].signature === input.signature.toLowerCase()
      ) return;
      if (current[0] && current[0].current_version >= input.version)
        throw new Error("LAUNCHPAD_BRANDING_VERSION_STALE");
      const slugOwner = await transaction.unsafe<{ launchpad_id: string }[]>(
        `select launchpad_id::text from ${this.schema}.launchpad_profiles where slug=$1 limit 1`,
        [input.branding.slug],
      );
      if (slugOwner[0] && slugOwner[0].launchpad_id !== input.branding.launchpadId)
        throw new Error("LAUNCHPAD_SLUG_TAKEN");
      await transaction.unsafe(
        `insert into ${this.schema}.launchpad_branding_versions(
          launchpad_id,version,owner_address,slug,name,description,primary_color,background_color,foreground_color,
          website_url,x_url,logo_mime,logo_bytes,logo_width,logo_height,favicon_mime,favicon_bytes,favicon_width,
          favicon_height,metadata_hash,signature,signed_at)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
        [
          input.branding.launchpadId,input.version,input.ownerAddress.toLowerCase(),input.branding.slug,
          input.branding.name,input.branding.description,input.branding.primaryColor,input.branding.backgroundColor,
          input.branding.foregroundColor,input.branding.websiteUrl,input.branding.xUrl,input.logo?.mime ?? null,
          input.logo ? Buffer.from(input.logo.bytes) : null,input.logo?.width ?? null,input.logo?.height ?? null,
          input.favicon?.mime ?? null,input.favicon ? Buffer.from(input.favicon.bytes) : null,
          input.favicon?.width ?? null,input.favicon?.height ?? null,input.metadataHash.toLowerCase(),
          input.signature.toLowerCase(),input.signedAt,
        ],
      );
      await transaction.unsafe(
        `insert into ${this.schema}.launchpad_profiles(launchpad_id,current_version,slug,metadata_hash,published,updated_at)
         values($1,$2,$3,$4,true,now())
         on conflict(launchpad_id) do update set current_version=excluded.current_version,slug=excluded.slug,
         metadata_hash=excluded.metadata_hash,published=true,updated_at=now()`,
        [input.branding.launchpadId,input.version,input.branding.slug,input.metadataHash.toLowerCase()],
      );
    });
  }

  async bySlug(slug: string): Promise<StoredLaunchpadBranding | null> {
    const rows = await this.#sql.unsafe<{
      launchpad_id: string; version: number; owner_address: `0x${string}`; slug: string;
      name: string; description: string; primary_color: string; background_color: string;
      foreground_color: string; website_url: string | null; x_url: string | null;
      logo_mime: "image/png" | "image/jpeg" | "image/webp" | null; logo_bytes: Buffer | null;
      logo_width: number | null; logo_height: number | null;
      favicon_mime: "image/png" | "image/jpeg" | "image/webp" | null; favicon_bytes: Buffer | null;
      favicon_width: number | null; favicon_height: number | null; metadata_hash: `0x${string}`;
      signature: `0x${string}`; signed_at: Date;
    }[]>(
      `select v.* from ${this.schema}.launchpad_profiles p join ${this.schema}.launchpad_branding_versions v
       on v.launchpad_id=p.launchpad_id and v.version=p.current_version
       where p.slug=$1 and p.published limit 1`,
      [slug],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      branding: {
        schemaVersion: 1,
        launchpadId: row.launchpad_id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        primaryColor: row.primary_color,
        backgroundColor: row.background_color,
        foregroundColor: row.foreground_color,
        websiteUrl: row.website_url,
        xUrl: row.x_url,
      },
      version: row.version,
      ownerAddress: row.owner_address,
      metadataHash: row.metadata_hash,
      signature: row.signature,
      signedAt: row.signed_at,
      logo: row.logo_bytes && row.logo_mime && row.logo_width && row.logo_height
        ? { mime: row.logo_mime, bytes: row.logo_bytes, width: row.logo_width, height: row.logo_height }
        : null,
      favicon: row.favicon_bytes && row.favicon_mime && row.favicon_width && row.favicon_height
        ? { mime: row.favicon_mime, bytes: row.favicon_bytes, width: row.favicon_width, height: row.favicon_height }
        : null,
    };
  }
}

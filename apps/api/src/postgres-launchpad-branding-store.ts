import postgres from "postgres";
import { isSupportedDatabaseSchema } from "@zkblast/config";
import type {
  LaunchpadBrandingStore,
  StoredLaunchpadBranding,
} from "./launchpad-branding-service.js";


export class PostgresLaunchpadBrandingStore implements LaunchpadBrandingStore {
  readonly #sql;

  constructor(
    databaseUrl: string,
    private readonly schema: string,
    private readonly chainId: number,
  ) {
    if (!isSupportedDatabaseSchema(schema))
      throw new Error("INVALID_DATABASE_SCHEMA");
    this.#sql = postgres(databaseUrl, {
      max: 2,
      prepare: false,
      idle_timeout: 10,
    });
  }

  async save(input: StoredLaunchpadBranding): Promise<void> {
    await this.#sql.begin(async (transaction) => {
      const current = await transaction.unsafe<
        {
          current_version: number;
          slug: string;
          metadata_hash: string;
          signature: string | null;
        }[]
      >(
        `select p.current_version,p.slug,p.metadata_hash,v.signature from ${this.schema}.launchpad_profiles p
         left join ${this.schema}.launchpad_branding_versions v on v.chain_id=p.chain_id and v.launchpad_id=p.launchpad_id and v.version=p.current_version
         where p.chain_id=$1 and p.launchpad_id=$2 for update of p`,
        [this.chainId,input.branding.launchpadId],
      );
      if (
        current[0]?.current_version === input.version &&
        current[0].metadata_hash === input.metadataHash.toLowerCase() &&
        current[0].signature === input.signature.toLowerCase()
      )
        return;
      if (current[0] && current[0].current_version >= input.version)
        throw new Error("LAUNCHPAD_BRANDING_VERSION_STALE");
      const slugOwner = await transaction.unsafe<{ launchpad_id: string }[]>(
        `select launchpad_id::text from ${this.schema}.launchpad_profiles where chain_id=$1 and slug=$2 limit 1`,
        [this.chainId,input.branding.slug],
      );
      if (
        slugOwner[0] &&
        slugOwner[0].launchpad_id !== input.branding.launchpadId
      )
        throw new Error("LAUNCHPAD_SLUG_TAKEN");
      await transaction.unsafe(
        `insert into ${this.schema}.launchpad_branding_versions(
          chain_id,launchpad_id,version,owner_address,slug,name,description,primary_color,background_color,foreground_color,
          website_url,x_url,logo_mime,logo_bytes,logo_width,logo_height,favicon_mime,favicon_bytes,favicon_width,
          favicon_height,metadata_hash,signature,signed_at)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
        [
          this.chainId,
          input.branding.launchpadId,
          input.version,
          input.ownerAddress.toLowerCase(),
          input.branding.slug,
          input.branding.name,
          input.branding.description,
          input.branding.primaryColor,
          input.branding.backgroundColor,
          input.branding.foregroundColor,
          input.branding.websiteUrl,
          input.branding.xUrl,
          input.logo?.mime ?? null,
          input.logo ? Buffer.from(input.logo.bytes) : null,
          input.logo?.width ?? null,
          input.logo?.height ?? null,
          input.favicon?.mime ?? null,
          input.favicon ? Buffer.from(input.favicon.bytes) : null,
          input.favicon?.width ?? null,
          input.favicon?.height ?? null,
          input.metadataHash.toLowerCase(),
          input.signature.toLowerCase(),
          input.signedAt,
        ],
      );
      await transaction.unsafe(
        `insert into ${this.schema}.launchpad_profiles(chain_id,launchpad_id,current_version,slug,metadata_hash,published,updated_at)
         values($1,$2,$3,$4,$5,true,now())
         on conflict(launchpad_id) do update set current_version=excluded.current_version,slug=excluded.slug,
         metadata_hash=excluded.metadata_hash,published=true,updated_at=now()`,
        [
          this.chainId,
          input.branding.launchpadId,
          input.version,
          input.branding.slug,
          input.metadataHash.toLowerCase(),
        ],
      );
    });
  }

  async bySlug(slug: string): Promise<StoredLaunchpadBranding | null> {
    return this.currentBranding("p.slug=$1", slug);
  }

  async slugsByLaunchpadIds(
    launchpadIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    if (launchpadIds.length === 0) return new Map();
    const rows = await this.#sql.unsafe<
      { launchpad_id: string; slug: string }[]
    >(
      `select launchpad_id::text,slug from ${this.schema}.launchpad_profiles
       where chain_id=$1 and published and launchpad_id=any($2::numeric[])`,
      [this.chainId,launchpadIds],
    );
    return new Map(rows.map((row) => [row.launchpad_id, row.slug]));
  }

  private async currentBranding(
    predicate: "p.slug=$1",
    value: string,
  ): Promise<StoredLaunchpadBranding | null> {
    const rows = await this.#sql.unsafe<
      {
        launchpad_id: string;
        version: number;
        owner_address: `0x${string}`;
        slug: string;
        name: string;
        description: string;
        primary_color: string;
        background_color: string;
        foreground_color: string;
        website_url: string | null;
        x_url: string | null;
        logo_mime: "image/png" | "image/jpeg" | "image/webp" | null;
        logo_bytes: Buffer | null;
        logo_width: number | null;
        logo_height: number | null;
        favicon_mime: "image/png" | "image/jpeg" | "image/webp" | null;
        favicon_bytes: Buffer | null;
        favicon_width: number | null;
        favicon_height: number | null;
        metadata_hash: `0x${string}`;
        signature: `0x${string}`;
        signed_at: Date;
      }[]
    >(
      `select v.* from ${this.schema}.launchpad_profiles p join ${this.schema}.launchpad_branding_versions v
       on v.chain_id=p.chain_id and v.launchpad_id=p.launchpad_id and v.version=p.current_version
       where p.chain_id=$1 and ${predicate.replace("$1", "$2")} and p.published limit 1`,
      [this.chainId,value],
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
      logo:
        row.logo_bytes && row.logo_mime && row.logo_width && row.logo_height
          ? {
              mime: row.logo_mime,
              bytes: row.logo_bytes,
              width: row.logo_width,
              height: row.logo_height,
            }
          : null,
      favicon:
        row.favicon_bytes &&
        row.favicon_mime &&
        row.favicon_width &&
        row.favicon_height
          ? {
              mime: row.favicon_mime,
              bytes: row.favicon_bytes,
              width: row.favicon_width,
              height: row.favicon_height,
            }
          : null,
    };
  }
}

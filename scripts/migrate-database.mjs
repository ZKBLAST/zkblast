import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import process from "node:process";
import postgres from "postgres";

const environment = process.env.APP_ENV;
const mode = process.argv[2];
const onlyMigration = process.argv[3];
if (onlyMigration && !/^\d{12}_[a-z0-9_]+\.sql$/u.test(onlyMigration)) {
  throw new Error("Invalid explicit migration filename");
}

if (environment !== "testnet" && environment !== "mainnet") {
  throw new Error("APP_ENV must be testnet or mainnet");
}
if (mode !== "apply" && mode !== "verify") {
  throw new Error("Migration mode must be apply or verify");
}

const expectedSchema = `zkblast_${environment}`;
if (process.env.SUPABASE_SCHEMA !== expectedSchema) {
  throw new Error(`SUPABASE_SCHEMA must equal ${expectedSchema}`);
}

const databaseUrl = process.env.SUPABASE_DIRECT_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("SUPABASE_DIRECT_DATABASE_URL is required");
}

const connection = new URL(databaseUrl);
if (!["postgres:", "postgresql:"].includes(connection.protocol)) {
  throw new Error("SUPABASE_DIRECT_DATABASE_URL must use PostgreSQL");
}

const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  ssl: "require",
  connect_timeout: 15,
  idle_timeout: 5,
});

const expectedTables = [
  "login_attempts",
  "trade_history",
  "user_sessions",
  "user_wallets",
  "users",
  "wallet_login_challenges",
];
const expectedProtocolTables = [
  "assets",
  "fee_events",
  "ingestion_checkpoints",
  "pools",
  "positions",
  "swaps",
  "transactions",
];
const expectedEventTables = ["indexed_blocks", "protocol_events"];
const expectedDbcTables = [
  "dbc_events",
  "dbc_graduations",
  "dbc_holder_balances",
  "dbc_launches",
  "dbc_lp_allocations",
  "dbc_monitoring",
  "dbc_swaps",
  "dbc_templates",
];
const expectedExternalMarketTables = [
  "external_market_curation_audit",
  "external_market_pairs",
  "external_market_price_points",
  "external_market_quotes",
  "external_markets",
];
const requiredColumns = {
  trade_history: [
    "client_request_id",
    "effective_gas_price_wei",
    "gas_used",
    "transaction_hash",
    "user_id",
    "wallet_id",
  ],
  ingestion_checkpoints: [
    "chain_id",
    "consumer",
    "finalized_block",
    "last_processed_block",
    "last_processed_hash",
  ],
  protocol_events: [
    "block_hash",
    "block_number",
    "chain_id",
    "event_kind",
    "log_index",
    "transaction_hash",
  ],
  external_market_pairs: [
    "base_address",
    "execution_chain_id",
    "market_id",
    "observed_at",
    "pool_identifier",
    "quote_address",
    "route_status",
  ],
  dbc_launches: [
    "launch_id",
    "template_id",
    "token_address",
    "virtual_pool",
    "quote_token",
    "lifecycle",
    "created_block",
  ],
  dbc_holder_balances: ["launch_id", "account", "balance_raw", "updated_block"],
  dbc_swaps: [
    "chain_id",
    "transaction_hash",
    "log_index",
    "launch_id",
    "price_x18",
    "canonical",
  ],
};

async function ensureMigrationLedger() {
  await sql.unsafe(`create schema if not exists ${expectedSchema}`);
  await sql.unsafe(`
    create table if not exists ${expectedSchema}.schema_migrations (
      filename text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);
  await sql.unsafe(
    `revoke all on ${expectedSchema}.schema_migrations from public, anon, authenticated`,
  );
  await sql.unsafe(
    `grant select, insert on ${expectedSchema}.schema_migrations to service_role`,
  );
}

async function applyMigrations() {
  const directory = `supabase/migrations/${environment}`;
  const filenames = (await readdir(directory))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  if (onlyMigration && !filenames.includes(onlyMigration))
    throw new Error("Migration not found");

  await sql`select pg_advisory_lock(hashtext(${`zkblast:${environment}:migrations`}))`;
  try {
    await ensureMigrationLedger();
    for (const filename of filenames) {
      if (onlyMigration && filename !== onlyMigration) continue;
      const migration = await readFile(`${directory}/${filename}`, "utf8");
      const checksum = createHash("sha256").update(migration).digest("hex");
      const [existing] = await sql.unsafe(
        `select checksum from ${expectedSchema}.schema_migrations where filename = $1`,
        [filename],
      );

      if (existing) {
        if (existing.checksum !== checksum) {
          throw new Error(`Applied migration checksum changed: ${filename}`);
        }
        continue;
      }

      await sql.begin(async (transaction) => {
        await transaction.unsafe(migration);
        await transaction.unsafe(
          `insert into ${expectedSchema}.schema_migrations (filename, checksum) values ($1, $2)`,
          [filename, checksum],
        );
      });
      console.log(`Applied migration: ${filename}`);
    }
  } finally {
    await sql`select pg_advisory_unlock(hashtext(${`zkblast:${environment}:migrations`}))`;
  }
}

async function verifyDatabase() {
  const allExpectedTables = [
    ...expectedTables,
    ...expectedProtocolTables,
    ...expectedEventTables,
    ...expectedDbcTables,
    ...expectedExternalMarketTables,
  ].sort();
  const tables = await sql`
    select table_name
    from information_schema.tables
    where table_schema = ${expectedSchema}
      and table_name = any(${allExpectedTables})
    order by table_name
  `;
  const actualTables = tables.map((row) => row.table_name);
  if (actualTables.join(",") !== allExpectedTables.join(",")) {
    throw new Error("Required application tables are missing");
  }

  for (const [table, expectedColumns] of Object.entries(requiredColumns)) {
    const columns = await sql`
      select column_name
      from information_schema.columns
      where table_schema = ${expectedSchema} and table_name = ${table}
        and column_name = any(${expectedColumns})
      order by column_name
    `;
    const actualColumns = columns.map((row) => row.column_name);
    if (actualColumns.join(",") !== [...expectedColumns].sort().join(",")) {
      throw new Error(`Schema drift detected in ${table}`);
    }
  }

  const rlsTables = await sql`
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = ${expectedSchema}
      and c.relname = any(${allExpectedTables})
      and c.relrowsecurity = true
    order by c.relname
  `;
  if (rlsTables.length !== allExpectedTables.length) {
    throw new Error("RLS is not enabled on every application table");
  }

  const browserRolePrivileges = await sql`
    select r.rolname, c.relname
    from pg_roles r
    cross join pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where r.rolname in ('anon', 'authenticated')
      and n.nspname = ${expectedSchema}
      and c.relname = any(${allExpectedTables})
      and has_table_privilege(
        r.rolname,
        format('%I.%I', n.nspname, c.relname),
        'SELECT,INSERT,UPDATE,DELETE'
      )
  `;
  if (browserRolePrivileges.length > 0) {
    throw new Error(
      "A browser database role has direct application-table access",
    );
  }

  const serviceRolePrivileges = await sql`
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = ${expectedSchema}
      and c.relname = any(${allExpectedTables})
      and has_table_privilege(
        'service_role',
        format('%I.%I', n.nspname, c.relname),
        'SELECT,INSERT,UPDATE,DELETE'
      )
  `;
  if (serviceRolePrivileges.length !== allExpectedTables.length) {
    throw new Error(
      "Backend service role is missing application-table privileges",
    );
  }

  const crossSchemaReferences = await sql`
    select count(*)::integer as count
    from information_schema.constraint_column_usage
    where table_schema = ${expectedSchema === "zkblast_testnet" ? "zkblast_mainnet" : "zkblast_testnet"}
      and constraint_schema = ${expectedSchema}
  `;
  if (crossSchemaReferences[0]?.count !== 0) {
    throw new Error("Cross-environment database reference detected");
  }

  console.log(
    `Verified ${allExpectedTables.length} backend-only application tables with RLS in ${expectedSchema}`,
  );
}

try {
  if (mode === "apply") await applyMigrations();
  await verifyDatabase();
} finally {
  await sql.end({ timeout: 5 });
}

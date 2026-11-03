import assert from "node:assert/strict";
import postgres from "postgres";

assert.equal(process.env.APP_ENV, "mainnet");
assert.equal(process.env.SUPABASE_SCHEMA, "zkblast_mainnet");
const sql = postgres(process.env.SUPABASE_DIRECT_DATABASE_URL, {
  ssl: "require",
  max: 1,
  prepare: false,
});
const launchId = "0x3e7c68dcee51dde3d2164d47a53bf95f1cac864284ea5adccc299d0541fd1e66";
try {
  const [policy, launch, identity, swaps, migration, allocation, discovery] = await Promise.all([
    sql`select policy_id::text,enabled,used from zkblast_mainnet.protected_launch_policies where chain_id=4663 and policy_id=1`,
    sql`select launch_id,token_address,pool_address,lifecycle from zkblast_mainnet.protected_launches where chain_id=4663 and launch_id=${launchId} and canonical`,
    sql`select launch_id,token_template_version from zkblast_mainnet.protected_launch_identities where chain_id=4663 and launch_id=${launchId} and canonical`,
    sql`select count(*)::integer as count from zkblast_mainnet.dbc_swaps where chain_id=4663 and launch_id=${launchId} and canonical`,
    sql`select migration_id,destination_pool_address,status,accounting_reconciles from zkblast_mainnet.protected_graduation_migrations where chain_id=4663 and launch_id=${launchId} and canonical`,
    sql`select creator_claimed,protocol_claimed,creator_unlock_at from zkblast_mainnet.protected_lp_allocations where chain_id=4663 and launch_id=${launchId} and canonical`,
    sql`select launch_id,name,symbol,lifecycle,graduation_threshold_raw::text from zkblast_mainnet.dbc_launches where chain_id=4663 and launch_id=${launchId}`,
  ]);
  assert.equal(policy.length, 1);
  assert.equal(policy[0].enabled, true);
  assert.equal(policy[0].used, true);
  assert.equal(launch.length, 1);
  assert.equal(identity.length, 1);
  assert(swaps[0].count >= 3);
  assert.equal(migration.length, 1);
  assert.equal(migration[0].status, 4);
  assert.equal(allocation.length, 1);
  assert.equal(allocation[0].creator_claimed, true);
  assert.equal(discovery.length, 1);
  console.log(JSON.stringify({
    launchId,
    policy: policy[0],
    launch: launch[0],
    identity: identity[0],
    indexedSwaps: swaps[0].count,
    migration: migration[0],
    allocation: allocation[0],
    discovery: discovery[0],
  }, null, 2));
} finally {
  await sql.end();
}

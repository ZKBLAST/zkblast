import assert from "node:assert/strict";
import test from "node:test";
import { LaunchpadReadService } from "../src/launchpad-read-service.js";

const freshness = { indexedBlock: "100", finalizedBlock: "105", lagBlocks: "5", indexedAt: "2026-11-02T00:00:00.000Z" };
const store = {
  freshness: async () => freshness,
  list: async () => [
    { launchpad_id: "2", updated_block: "90" },
    { launchpad_id: "1", updated_block: "80" },
  ],
  detail: async (id: string) => ({ launchpad_id: id }),
  tokens: async (id: string) => [{ launchpad_id: id, launch_id: "0x01" }],
  trades: async (id: string) => [{ launchpad_id: id, transaction_hash: "0x02" }],
  fees: async (id: string) => ({ launchpad_id: id, snapshots: [] }),
  graduations: async (id: string) => [{ launchpad_id: id, status: "GRADUATED" }],
  boundPool: async (_id: string,pool: string) => ({ virtual_pool: pool, template_id: "1", lifecycle: 1 }),
  health: async () => ({ launchpads: "1", bound_launches: "1", failed_graduations: "0", pending_retries: "0", missing_launchpad_bindings: "0", incomplete_fee_snapshots: "0", webhook_pending: "0", webhook_dead_letters: "0", domains_pending: "0", domains_expired: "0" }),
  events: async () => [{ block_number: "101", log_index: 2, event_name: "LaunchpadCreated" }],
};

test("launchpad read responses retain environment, chain and index freshness", async () => {
  const service = new LaunchpadReadService("testnet",46630,store,{ quote: async () => ({ amountOutRaw: "10" }) },async () => 105n);
  assert.deepEqual(await service.detail("7"), {
    environment: "testnet", chainId: 46630, freshness, data: { launchpad_id: "7" },
  });
  const page = await service.list(1);
  assert.deepEqual(page.data, { items: [{ launchpad_id: "2", updated_block: "90" }], nextCursor: "90:2" });
  assert.equal((await service.tokens("7",25)).data.length,1);
  assert.equal((await service.trades("7",25)).data.length,1);
  assert.equal((await service.graduations("7",25)).data.length,1);
  assert.equal((await service.health()).status,"healthy");
  assert.deepEqual((await service.quote("7","0x0000000000000000000000000000000000000001","buy",1n)).data, {
    binding: { virtual_pool: "0x0000000000000000000000000000000000000001", template_id: "1", lifecycle: 1 },
    quote: { amountOutRaw: "10" },
  });
  assert.equal((await service.events("100",0,25)).data.nextCursor,"101:2");
});

import assert from "node:assert/strict";
import test from "node:test";
import type { PublicClient } from "viem";
import {
  parseStockChartFeeds,
  stockOracleHistory,
} from "../src/chart-oracle-source.js";

const address = "0x0000000000000000000000000000000000000001" as const;
test("registry mapping accepts Robinhood USD feeds only from the Robinhood network section", () => {
  const feed = `"heartbeat":[0,3600],"name":[0,"Robinhood MSFT / USD"],"proxyAddress":[0,"${address}"]`;
  const feeds = parseStockChartFeeds(
    `"robinhood":[0,{${feed}}],"ronin":[0,{${feed.replace("MSFT", "FOREIGN")}}]`,
  );
  assert.equal(feeds.size, 1);
  assert.equal(feeds.get("MSFT")?.address, address);
  assert.throws(() => parseStockChartFeeds("unrecognized registry response"));
});

function clientWith(round: readonly bigint[]) {
  return {
    readContract: async ({ functionName }: { functionName: string }) =>
      functionName === "decimals" ? 8 : round,
  } as unknown as PublicClient;
}
test("oracle data requires positive complete rounds with an actual nonfuture timestamp", async () => {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const points = await stockOracleHistory(
    clientWith([1n, 12345000000n, now, now, 1n]),
    { address, heartbeat: 3600 },
    false,
  );
  assert.equal(points[0]?.price, "123.45");
  for (const round of [
    [1n, 0n, now, now, 1n],
    [2n, 1n, now, now, 1n],
  ])
    assert.deepEqual(
      await stockOracleHistory(
        clientWith(round),
        { address, heartbeat: 3600 },
        false,
      ),
      [],
    );
  await assert.rejects(
    stockOracleHistory(
      clientWith([1n, 1n, now, now + 60n, 1n]),
      { address, heartbeat: 3600 },
      false,
    ),
  );
  await assert.rejects(
    stockOracleHistory(
      clientWith([1n, 1n, now, now - 864000n, 1n]),
      { address, heartbeat: 3600 },
      false,
    ),
  );
});

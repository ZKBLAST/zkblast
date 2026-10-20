import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import path from "node:path";
import {
  encodeFunctionData,
  parseAbi,
  getAddress,
  decodeEventLog,
  type Abi,
  type Address,
} from "viem";
import {
  runtime,
  check,
  root,
  readJson,
  saveJson,
} from "./pons-dlmm-runtime.js";
import { preparePonsSource } from "./pons-dlmm-source.js";
import { initialBinForHumanPrice, priceFromBin } from "./dlmm-bin-math.js";
import { prepareSafeOperation } from "./safe-operation.js";

async function main() {
  const stage = process.argv[2];
  check(
    ["preflight", "buy", "create", "fund"].includes(stage ?? ""),
    "Choose preflight/buy/create/fund",
  );
  const r = await runtime();
  const { config: cfg, client: c, account, manifest, journal: j } = r;
  const source = await preparePonsSource(r);
  const { pons, weth, usdg, balance, metadata, reference, quoteBuy, approve } =
    source;
  if (stage === "preflight") {
    const ref = await reference();
    const initial = initialBinForHumanPrice(
      ref.ponsUsdg,
      18,
      6,
      cfg.binStepBps,
    );
    console.log(
      JSON.stringify(
        {
          chainId: 4663,
          owner: account.address,
          balances: {
            pons: String(await balance(pons)),
            weth: String(await balance(weth)),
            usdg: String(await balance(usdg)),
          },
          purchaseOutRaw: String(await quoteBuy()),
          reference: ref,
          initial,
        },
        (_, value) => (typeof value === "bigint" ? String(value) : value),
        2,
      ),
    );
    return;
  }
  if (stage === "buy") {
    await source.buy();
    return;
  }
  check(j.purchase?.received, "Purchase must complete first");
  const factoryArtifact = await readJson(
    "packages/contracts/out/PoolFactory.sol/PoolFactory.json",
  );
  const factory = getAddress(manifest.integration.poolFactory);
  const safe = getAddress(manifest.governanceAddress);
  check(pons.toLowerCase() < usdg.toLowerCase(), "Unsupported token ordering");
  if (stage === "create") {
    if (!j.poolPlan) {
      const ref = await reference();
      const initial = initialBinForHumanPrice(
        ref.ponsUsdg,
        18,
        6,
        cfg.binStepBps,
      );
      const binId = initial.binId;
      check(Number.isInteger(binId), "Invalid initial bin");
      const key = {
        token0: pons,
        token1: usdg,
        model: 1,
        feePips: cfg.feePips,
        binStepBps: cfg.binStepBps,
      };
      const predicted = await c.readContract({
        address: factory,
        abi: factoryArtifact.abi,
        functionName: "predictDlmmPoolAddress",
        args: [key, safe, binId],
      });
      j.poolPlan = { reference: ref, binId, address: predicted, key };
      await r.save();
    }
    if (!j.steps.create) {
      const fresh = await reference();
      const initial = initialBinForHumanPrice(
        fresh.ponsUsdg,
        18,
        6,
        cfg.binStepBps,
      );
      check(
        Math.abs(initial.binId - j.poolPlan.binId) <= 1,
        "Initial price moved; review pool plan",
      );
      const testnet = parseEnv(
        await readFile(path.join(root, ".env.testnet"), "utf8"),
      );
      for (const name of ["GOVERNANCE_PRIVATE_KEY", "UPGRADER_PRIVATE_KEY"]) {
        if (!/^0x[\da-f]{64}$/iu.test(process.env[name] ?? ""))
          process.env[name] = testnet[name];
      }
      const data = encodeFunctionData({
        abi: factoryArtifact.abi,
        functionName: "createDlmmPool",
        args: [pons, usdg, cfg.feePips, cfg.binStepBps, j.poolPlan.binId],
      });
      const operation = await prepareSafeOperation(c, {
        chainId: 4663,
        safe,
        to: factory,
        data,
        relayer: account,
      });
      await r.send("create", operation.to, operation.data, 4000000n);
    }
    await r.send("create", safe, "0x", 4000000n);
    const registered = await c.readContract({
      address: getAddress(manifest.integration.poolRegistry),
      abi: parseAbi(["function isRegisteredPool(address) view returns(bool)"]),
      functionName: "isRegisteredPool",
      args: [getAddress(j.poolPlan.address)],
    });
    check(registered, "Created pool not registered");
    console.log(
      JSON.stringify({ pool: j.poolPlan.address, binId: j.poolPlan.binId }),
    );
    return;
  }
  check(j.steps.create?.receipt, "Create must complete first");
  const dlmm = getAddress(j.poolPlan.address);
  const manager = getAddress(manifest.integration.positionManager);
  const managerArtifact = await readJson(
    "packages/contracts/out/PositionManager.sol/PositionManager.json",
  );
  const poolArtifact = await readJson(
    "packages/contracts/out/DlmmPool.sol/DlmmPool.json",
  );
  if (!j.funding) {
    const fresh = await reference();
    const active = initialBinForHumanPrice(
      fresh.ponsUsdg,
      18,
      6,
      cfg.binStepBps,
    );
    check(
      Math.abs(active.binId - j.poolPlan.binId) <= 1,
      "Funding price drift",
    );
    const available = (BigInt(j.purchase.received) * 98n) / 100n;
    const allocations = [-1, 0, 1].map((offset) => {
      const binId = j.poolPlan.binId + offset;
      const amount0 = (available * (offset === 0 ? 2n : 1n)) / 4n;
      const amount1 =
        (amount0 * priceFromBin(binId, cfg.binStepBps)) / 10n ** 18n;
      check(amount0 > 0n && amount1 > 0n, "Dust allocation");
      return { binId, amount0: String(amount0), amount1: String(amount1) };
    });
    check(
      allocations.reduce((sum, a) => sum + BigInt(a.amount1), 0n) <=
        BigInt(cfg.maximumUsdgRaw),
      "USDG cap exceeded",
    );
    j.funding = { allocations, reference: fresh };
    await r.save();
  }
  for (const allocation of j.funding.allocations) {
    const name = `position:${allocation.binId}`;
    if (j.steps[name]?.receipt) continue;
    if (j.steps[name]?.hash) {
      await r.send(name, manager, "0x", 700000n);
      continue;
    }
    const amount0 = BigInt(allocation.amount0),
      amount1 = BigInt(allocation.amount1);
    check(
      (await balance(pons)) >= amount0 && (await balance(usdg)) >= amount1,
      "Insufficient LP assets",
    );
    await approve(`approve:pons:${allocation.binId}`, pons, manager, amount0);
    await approve(`approve:usdg:${allocation.binId}`, usdg, manager, amount1);
    const args = [
      dlmm,
      allocation.binId,
      amount0,
      amount1,
      1n,
      BigInt(Math.floor(Date.now() / 1000) + 180),
    ];
    const simulation = await c.simulateContract({
      account,
      address: manager,
      abi: managerArtifact.abi,
      functionName: "createDlmmPosition",
      args,
    });
    const shares = (simulation.result as readonly bigint[])[1]!;
    args[4] = (shares * 99n) / 100n;
    await r.contract(
      name,
      manager,
      managerArtifact.abi,
      "createDlmmPosition",
      args,
      700000n,
    );
  }
  const positions = [];
  for (const allocation of j.funding.allocations) {
    const receipt = await c.getTransactionReceipt({
      hash: j.steps[`position:${allocation.binId}`].hash,
    });
    for (const log of receipt.logs) {
      if (getAddress(log.address) !== manager) continue;
      try {
        const event = decodeEventLog({
          abi: managerArtifact.abi as Abi,
          data: log.data,
          topics: log.topics,
        });
        if (event.eventName === "PositionCreated") positions.push(event.args);
      } catch {
        /* Ignore unrelated manager logs. */
      }
    }
    const state = (await c.readContract({
      address: dlmm,
      abi: poolArtifact.abi,
      functionName: "binState",
      args: [allocation.binId],
    })) as readonly bigint[];
    check(
      state[0]! > 0n && state[1]! > 0n && state[2]! > 1000n,
      "Funded bin validation failed",
    );
  }
  check(positions.length === 3, "Incomplete positions");
  const transactions = Object.fromEntries(
    Object.entries(j.steps).map(([name, item]: [string, any]) => [
      name,
      item.receipt,
    ]),
  );
  const receipts = Object.values(transactions) as {
    gasUsed: string;
    totalFeeWei: string;
  }[];
  await saveJson("deployments/mainnet/pons-dlmm-market.json", {
    protocol: "ZKBLAST",
    environment: "mainnet",
    chainId: 4663,
    owner: account.address,
    generatedAt: new Date().toISOString(),
    tokens: [metadata[0], metadata[2]],
    pool: {
      address: dlmm,
      model: "dlmm",
      feePips: cfg.feePips,
      feeBps: cfg.feePips / 100,
      binStepBps: cfg.binStepBps,
      initialActiveBin: j.poolPlan.binId,
      createdBlock: j.steps.create.receipt.blockNumber,
    },
    purchase: j.purchase,
    allocations: j.funding.allocations,
    reference: j.funding.reference,
    positions,
    transactions,
    totals: {
      transactionCount: receipts.length,
      gasUsed: String(
        receipts.reduce((sum, receipt) => sum + BigInt(receipt.gasUsed), 0n),
      ),
      totalFeeWei: String(
        receipts.reduce(
          (sum, receipt) => sum + BigInt(receipt.totalFeeWei),
          0n,
        ),
      ),
    },
  });
  console.log(
    JSON.stringify({ funded: true, pool: dlmm, positions: positions.length }),
  );
}
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Activation failed";
  console.error(
    message
      .replace(/https?:\/\/[^\s]+/gu, "[REDACTED_URL]")
      .replace(/0x[\da-f]{64}/giu, "[REDACTED_HASH]"),
  );
  process.exitCode = 1;
});

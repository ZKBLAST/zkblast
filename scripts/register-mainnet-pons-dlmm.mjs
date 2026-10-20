import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { createPublicClient, getAddress, http, parseAbi } from "viem";

function check(value, message) {
  if (!value) throw new Error(message);
}
async function main() {
  check(
    process.env.APP_ENV === "mainnet" &&
      process.env.CHAIN_ID === "4663" &&
      process.env.SUPABASE_SCHEMA === "zkblast_mainnet",
    "Isolated mainnet required",
  );
  const load = async (file) => JSON.parse(await readFile(file, "utf8"));
  const market = await load("deployments/mainnet/pons-dlmm-market.json");
  const manifest = await load("deployments/mainnet/manifest.json");
  const config = await load("data/mainnet-pons-dlmm.json");
  check(
    market.chainId === 4663 &&
      market.environment === "mainnet" &&
      market.pool.model === "dlmm",
    "Market identity mismatch",
  );
  const c = createPublicClient({ transport: http(process.env.RPC_URL) });
  check((await c.getChainId()) === 4663, "Wrong RPC chain");
  const pool = getAddress(market.pool.address);
  const poolAbi = parseAbi([
    "function token0() view returns(address)",
    "function token1() view returns(address)",
    "function factory() view returns(address)",
    "function model() view returns(uint8)",
    "function feePips() view returns(uint24)",
    "function binStepBps() view returns(uint16)",
    "function activeBin() view returns(int24)",
    "function binState(int24) view returns(uint128,uint128,uint256,uint256)",
  ]);
  const readPool = (functionName, args) =>
    c.readContract({ address: pool, abi: poolAbi, functionName, args });
  check(await c.getBytecode({ address: pool }), "Missing runtime");
  check(
    (await readPool("factory")) ===
      getAddress(manifest.integration.poolFactory),
    "Wrong pool factory",
  );
  check(
    (await readPool("model")) === 1 &&
      (await readPool("feePips")) === config.feePips &&
      (await readPool("binStepBps")) === config.binStepBps,
    "Wrong pool parameters",
  );
  check(
    await c.readContract({
      address: getAddress(manifest.integration.poolRegistry),
      abi: parseAbi(["function isRegisteredPool(address) view returns(bool)"]),
      functionName: "isRegisteredPool",
      args: [pool],
    }),
    "Unregistered pool",
  );
  const tokenAbi = parseAbi([
    "function symbol() view returns(string)",
    "function name() view returns(string)",
    "function decimals() view returns(uint8)",
  ]);
  for (const [index, functionName] of ["token0", "token1"].entries()) {
    const token = market.tokens[index];
    check(
      (await readPool(functionName)) === getAddress(token.address),
      "Wrong token order",
    );
    for (const field of ["symbol", "name", "decimals"])
      check(
        (await c.readContract({
          address: getAddress(token.address),
          abi: tokenAbi,
          functionName: field,
        })) === token[field],
        "Token metadata mismatch",
      );
  }
  const activeBin = await readPool("activeBin");
  const state = await readPool("binState", [activeBin]);
  check(
    state[0] > 0n && state[1] > 0n && state[2] > 1000n,
    "Active bin not funded",
  );
  const receipts = [];
  for (const [stage, expected] of Object.entries(market.transactions)) {
    const receipt = await c.getTransactionReceipt({ hash: expected.hash });
    const block = await c.getBlock({ blockNumber: receipt.blockNumber });
    check(
      receipt.status === "success" &&
        receipt.blockHash === block.hash &&
        receipt.blockHash === expected.blockHash &&
        String(receipt.gasUsed) === expected.gasUsed,
      `Invalid canonical receipt: ${stage}`,
    );
    receipts.push({ stage, receipt, block });
  }
  const managerAbi = parseAbi([
    "function positions(uint256) view returns(address,address,uint8,int24,uint256)",
  ]);
  for (const position of market.positions) {
    const actual = await c.readContract({
      address: getAddress(manifest.integration.positionManager),
      abi: managerAbi,
      functionName: "positions",
      args: [BigInt(position.positionId)],
    });
    check(
      actual[0] === getAddress(market.owner) &&
        actual[1] === pool &&
        actual[2] === 1 &&
        actual[3] === position.binId &&
        String(actual[4]) === position.shares,
      "Position mismatch",
    );
  }
  const sql = postgres(process.env.SUPABASE_DIRECT_DATABASE_URL, {
    max: 1,
    prepare: false,
    ssl: "require",
    connect_timeout: 15,
    idle_timeout: 5,
  });
  try {
    await sql.begin(async (tx) => {
      const assets = [];
      for (const token of market.tokens) {
        const rows =
          await tx`insert into zkblast_mainnet.assets (chain_id,address,symbol,name,decimals,is_verified)
          values (4663,${token.address.toLowerCase()},${token.symbol},${token.name},${token.decimals},true)
          on conflict (chain_id,address) do update set symbol=excluded.symbol,name=excluded.name,
            decimals=excluded.decimals,is_verified=true,updated_at=now() returning id`;
        assets.push(rows[0].id);
      }
      const pools = await tx`insert into zkblast_mainnet.pools
        (chain_id,address,pool_kind,token_x_id,token_y_id,fee_bps,status,created_block)
        values (4663,${pool.toLowerCase()},'dlmm',${assets[0]},${assets[1]},${market.pool.feeBps},'active',${market.pool.createdBlock})
        on conflict (chain_id,address) do update set pool_kind='dlmm',token_x_id=excluded.token_x_id,
          token_y_id=excluded.token_y_id,status='active',updated_at=now() returning id`;
      for (const { receipt } of receipts)
        await tx`insert into zkblast_mainnet.transactions
        (chain_id,transaction_hash,status,block_number,gas_used,effective_gas_price_wei)
        values (4663,${receipt.transactionHash.toLowerCase()},'confirmed',${String(receipt.blockNumber)},
          ${String(receipt.gasUsed)},${String(receipt.effectiveGasPrice)})
        on conflict (chain_id,transaction_hash) do update set status='confirmed',block_number=excluded.block_number,
          gas_used=excluded.gas_used,effective_gas_price_wei=excluded.effective_gas_price_wei,updated_at=now()`;
      const wallets =
        await tx`select id,user_id from zkblast_mainnet.user_wallets
        where wallet_address=${market.owner.toLowerCase()} limit 1`;
      if (wallets[0])
        for (const position of market.positions) {
          const created = receipts.find(
            (r) => r.stage === `position:${position.binId}`,
          );
          await tx`insert into zkblast_mainnet.positions
          (user_id,wallet_id,pool_id,onchain_position_id,liquidity_raw,lower_bound,upper_bound,status,opened_at)
          values (${wallets[0].user_id},${wallets[0].id},${pools[0].id},${position.positionId},
            ${position.shares},${position.binId},${position.binId},'open',${new Date(Number(created.block.timestamp) * 1000)})
          on conflict (pool_id,onchain_position_id) do update set liquidity_raw=excluded.liquidity_raw,
            status='open',updated_at=now()`;
        }
      const rows =
        await tx`select id,metadata from zkblast_mainnet.external_markets
        where source='pons_graduated' and contract_address=${market.tokens[0].address.toLowerCase()}`;
      check(
        rows.length === 1,
        "Expected one existing verified PONS catalogue entry",
      );
      const usdgLogo =
        "https://mintcdn.com/paxos-0ac97319/ykAU2vouTvwgGjtD/images/usdg.png?fit=max&auto=format&n=ykAU2vouTvwgGjtD&q=85&s=3a2dfa481556c8322f0271baedb00afe";
      const metadata = {
        ...rows[0].metadata,
        executionAddress: market.tokens[0].address.toLowerCase(),
        executionChainId: 4663,
        executionDecimals: 18,
        zkblastTargetQuoteAddress: market.tokens[1].address.toLowerCase(),
        zkblastTargetQuoteSymbol: "USDG",
        quoteLogos: { ...rows[0].metadata.quoteLogos, USDG: usdgLogo },
      };
      await tx`update zkblast_mainnet.external_markets set quote_symbol='USDG',read_only=false,
        metadata=${sql.json(metadata)},validated_at=now(),updated_at=now() where id=${rows[0].id}`;
      const pairs =
        await tx`select quote_address,priority from zkblast_mainnet.external_market_pairs where market_id=${rows[0].id}`;
      const existing = pairs.find(
        (p) => p.quote_address === market.tokens[1].address.toLowerCase(),
      );
      const priority =
        existing?.priority ??
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].find(
          (n) => !pairs.some((p) => p.priority === n),
        );
      check(priority, "No pair priority available");
      const block = await c.getBlock();
      await tx`insert into zkblast_mainnet.external_market_pairs
        (market_id,data_chain_id,execution_chain_id,base_address,quote_symbol,quote_address,priority,
          route_status,venue,pool_identifier,fee_tier,liquidity_raw,observed_block,observed_at,validated_at,metadata)
        values (${rows[0].id},4663,4663,${market.tokens[0].address.toLowerCase()},'USDG',
          ${market.tokens[1].address.toLowerCase()},${priority},'validated','zkblast_dlmm',${pool.toLowerCase()},
          ${market.pool.feePips},${String(state[2])},${String(block.number)},now(),now(),
          ${sql.json({ provenance: "canonical_receipts_and_registry", binStepBps: config.binStepBps, activeBin })})
        on conflict (market_id,quote_address) do update set route_status='validated',venue='zkblast_dlmm',
          pool_identifier=excluded.pool_identifier,base_address=excluded.base_address,fee_tier=excluded.fee_tier,
          liquidity_raw=excluded.liquidity_raw,observed_block=excluded.observed_block,observed_at=now(),
          validated_at=now(),metadata=excluded.metadata,updated_at=now()`;
    });
    console.log(
      JSON.stringify({
        registered: true,
        chainId: 4663,
        pool,
        receiptCount: receipts.length,
        positionCount: market.positions.length,
        existingUserPositionsPersisted: "only for already registered wallet",
      }),
    );
  } finally {
    await sql.end();
  }
}
main().catch((error) => {
  console.error(
    String(error.message).replace(/https?:\/\/[^\s]+/gu, "[REDACTED_URL]"),
  );
  process.exitCode = 1;
});

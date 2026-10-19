import { readFile } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import { createPublicClient, getAddress, http, parseAbi } from "viem";

if (process.env.APP_ENV !== "mainnet" || process.env.CHAIN_ID !== "4663")
  throw new Error("Mainnet chain 4663 required");
if (process.env.SUPABASE_SCHEMA !== "zkblast_mainnet")
  throw new Error("Mainnet schema required");
const databaseUrl = process.env.SUPABASE_DIRECT_DATABASE_URL?.trim();
const rpcUrl = process.env.RPC_URL?.trim();
const quoteAddress = getAddress(process.env.EXECUTION_USDG_ADDRESS ?? "");
if (!databaseUrl || !rpcUrl) throw new Error("Server configuration missing");

const [catalogue, deployment] = await Promise.all([
  readFile(path.resolve("data/mainnet-stock-markets.json"), "utf8").then(
    JSON.parse,
  ),
  readFile(
    path.resolve("deployments/mainnet/stock-market-pools.json"),
    "utf8",
  ).then(JSON.parse),
]);
if (catalogue.chainId !== 4663 || deployment.chainId !== 4663)
  throw new Error("Stock market artifact chain mismatch");

const poolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function feePips() view returns (uint24)",
  "function reserve0() view returns (uint112)",
  "function reserve1() view returns (uint112)",
  "function totalShares() view returns (uint256)",
]);
const client = createPublicClient({ transport: http(rpcUrl) });
if ((await client.getChainId()) !== 4663) throw new Error("RPC chain mismatch");
const sql = postgres(databaseUrl, { max: 1, prepare: true });
const quoteLogo =
  "https://mintcdn.com/paxos-0ac97319/ykAU2vouTvwgGjtD/images/usdg.png?fit=max&auto=format&n=ykAU2vouTvwgGjtD&q=85&s=3a2dfa481556c8322f0271baedb00afe";

try {
  const validated = [];
  const definitions = new Map(
    catalogue.markets.map((market) => [market.symbol, market]),
  );
  for (const deployed of Object.values(deployment.markets)) {
    const definition = definitions.get(deployed.symbol);
    if (!definition)
      throw new Error(`Missing catalogue market: ${deployed.symbol}`);
    const pool = getAddress(deployed.poolAddress);
    const base = getAddress(definition.address);
    const [code, token0, token1, feePips, reserve0, reserve1, shares] =
      await Promise.all([
        client.getBytecode({ address: pool }),
        client.readContract({
          address: pool,
          abi: poolAbi,
          functionName: "token0",
        }),
        client.readContract({
          address: pool,
          abi: poolAbi,
          functionName: "token1",
        }),
        client.readContract({
          address: pool,
          abi: poolAbi,
          functionName: "feePips",
        }),
        client.readContract({
          address: pool,
          abi: poolAbi,
          functionName: "reserve0",
        }),
        client.readContract({
          address: pool,
          abi: poolAbi,
          functionName: "reserve1",
        }),
        client.readContract({
          address: pool,
          abi: poolAbi,
          functionName: "totalShares",
        }),
      ]);
    const tokens = new Set([getAddress(token0), getAddress(token1)]);
    if (
      !code ||
      code === "0x" ||
      !tokens.has(base) ||
      !tokens.has(quoteAddress)
    )
      throw new Error(`Pool validation failed: ${definition.symbol}`);
    if (feePips !== 3000 || reserve0 !== 0n || reserve1 !== 0n || shares !== 0n)
      throw new Error(`Unexpected pool state: ${definition.symbol}`);
    validated.push({ definition, deployed, pool, base });
  }

  await sql.begin(async (transaction) => {
    const quoteRows = await transaction`
      insert into zkblast_mainnet.assets (chain_id,address,symbol,name,decimals,is_verified)
      values (4663,${quoteAddress.toLowerCase()},'USDG','Global Dollar',6,true)
      on conflict (chain_id,address) do update set symbol='USDG',name='Global Dollar',decimals=6,is_verified=true,updated_at=now()
      returning id
    `;
    const quoteAssetId = quoteRows[0].id;
    for (const { definition, deployed, pool, base } of validated) {
      const baseRows = await transaction`
        insert into zkblast_mainnet.assets (chain_id,address,symbol,name,decimals,is_verified)
        values (4663,${base.toLowerCase()},${definition.symbol},${deployed.name},18,true)
        on conflict (chain_id,address) do update set symbol=excluded.symbol,name=excluded.name,decimals=18,is_verified=true,updated_at=now()
        returning id
      `;
      await transaction`
        insert into zkblast_mainnet.pools (chain_id,address,pool_kind,token_x_id,token_y_id,fee_bps,status,created_block)
        values (4663,${pool.toLowerCase()},'damm',${baseRows[0].id},${quoteAssetId},30,'active',${deployed.transaction.blockNumber})
        on conflict (chain_id,address) do update set token_x_id=excluded.token_x_id,token_y_id=excluded.token_y_id,fee_bps=30,status='active',updated_at=now()
      `;
      const metadata = {
        executionAddress: base.toLowerCase(),
        executionChainId: 4663,
        executionDecimals: 18,
        executionTokenType: "canonical_mainnet_stock_token",
        quoteLogos: { USDG: quoteLogo },
      };
      const existingMarkets = await transaction`
        select market.id,
               (select count(*) from zkblast_mainnet.external_market_pairs pair where pair.market_id=market.id)::int as route_count
          from zkblast_mainnet.external_markets market
         where market.source='robinhood_stock_token' and market.symbol=${definition.symbol}
         order by route_count desc,market.updated_at desc
      `;
      let marketId = existingMarkets[0]?.id;
      if (marketId) {
        await transaction`
          update zkblast_mainnet.external_markets
             set execution_chain_id=4663,contract_address=${base.toLowerCase()},name=${deployed.name},
                 quote_symbol='USDG',status='active',read_only=true,market_region='us',
                 candidate_logo_url=${definition.logoUrl},logo_url=${definition.logoUrl},
                 logo_status='approved',logo_validated_at=now(),metadata=${sql.json(metadata)},
                 validated_at=now(),updated_at=now()
           where id=${marketId}
        `;
        const duplicateIds = existingMarkets.slice(1).map((row) => row.id);
        if (duplicateIds.length)
          await transaction`
            delete from zkblast_mainnet.external_markets where id = any(${duplicateIds}::uuid[])
          `;
      } else {
        const marketRows = await transaction`
          insert into zkblast_mainnet.external_markets
            (source,external_id,chain_id,execution_chain_id,contract_address,symbol,name,quote_symbol,status,read_only,market_region,candidate_logo_url,logo_url,logo_status,logo_validated_at,metadata,validated_at)
          values ('robinhood_stock_token',${`mainnet:${base.toLowerCase()}`},4663,4663,${base.toLowerCase()},${definition.symbol},${deployed.name},'USDG','active',true,'us',${definition.logoUrl},${definition.logoUrl},'approved',now(),${sql.json(metadata)},now())
          returning id
        `;
        marketId = marketRows[0].id;
      }
      await transaction`
        insert into zkblast_mainnet.external_market_pairs
          (market_id,data_chain_id,execution_chain_id,quote_symbol,quote_address,base_address,priority,route_status,venue,pool_identifier,fee_tier,liquidity_raw,observed_block,observed_at,metadata)
        values (${marketId},4663,4663,'USDG',${quoteAddress.toLowerCase()},${base.toLowerCase()},1,'observed','zkblast_damm',${pool.toLowerCase()},3000,0,${deployed.transaction.blockNumber},now(),${sql.json({ liquidityStatus: "awaiting_initial_liquidity" })})
        on conflict (market_id,quote_address) do update set execution_chain_id=4663,base_address=excluded.base_address,route_status='observed',venue='zkblast_damm',pool_identifier=excluded.pool_identifier,fee_tier=3000,liquidity_raw=0,observed_block=excluded.observed_block,observed_at=now(),validated_at=null,metadata=excluded.metadata,updated_at=now()
      `;
    }
  });
  console.log(
    `Registered ${validated.length} verified mainnet stock pools and observed routes`,
  );
} finally {
  await sql.end();
}

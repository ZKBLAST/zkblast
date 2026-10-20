import { readFile } from "node:fs/promises";
import postgres from "postgres";
import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  parseAbi,
} from "viem";

async function main() {
  if (
    process.env.APP_ENV !== "testnet" ||
    process.env.CHAIN_ID !== "46630" ||
    process.env.SUPABASE_SCHEMA !== "zkblast_testnet"
  )
    throw new Error("Isolated testnet configuration required");
  const market = JSON.parse(
    await readFile("deployments/testnet/dlmm-market.json", "utf8"),
  );
  const deployment = JSON.parse(
    await readFile("deployments/testnet/manifest.json", "utf8"),
  );
  if (
    market.chainId !== 46630 ||
    market.environment !== "testnet" ||
    market.pool.model !== "dlmm"
  )
    throw new Error("DLMM manifest identity mismatch");
  const client = createPublicClient({ transport: http(process.env.RPC_URL) });
  if ((await client.getChainId()) !== 46630)
    throw new Error("RPC chain mismatch");
  const pool = getAddress(market.pool.address);
  const poolAbi = parseAbi([
    "function token0() view returns(address)",
    "function token1() view returns(address)",
    "function model() view returns(uint8)",
    "function factory() view returns(address)",
    "function feePips() view returns(uint24)",
    "function binStepBps() view returns(uint16)",
    "function activeBin() view returns(int24)",
    "function binState(int24) view returns(uint128 reserve0,uint128 reserve1,uint256 totalShares,uint256 priceX18)",
    "event Swap(address indexed sender,address indexed recipient,bool token0ToToken1,uint256 amountIn,uint256 amountOut,uint256 protocolFee,int24 finalActiveBin)",
  ]);
  const tokenAbi = parseAbi([
    "function symbol() view returns(string)",
    "function name() view returns(string)",
    "function decimals() view returns(uint8)",
  ]);
  const registered = await client.readContract({
    address: getAddress(deployment.integration.poolRegistry),
    abi: parseAbi(["function isRegisteredPool(address) view returns(bool)"]),
    functionName: "isRegisteredPool",
    args: [pool],
  });
  const [code, token0, token1, model, factory, fee, step, activeBin] =
    await Promise.all([
      client.getBytecode({ address: pool }),
      ...[
        "token0",
        "token1",
        "model",
        "factory",
        "feePips",
        "binStepBps",
        "activeBin",
      ].map((functionName) =>
        client.readContract({ address: pool, abi: poolAbi, functionName }),
      ),
    ]);
  if (
    !registered ||
    !code ||
    code === "0x" ||
    model !== 1 ||
    getAddress(factory) !== getAddress(deployment.integration.poolFactory) ||
    fee !== 3000 ||
    step !== 25
  )
    throw new Error("Pool runtime/configuration validation failed");
  const activeState = await client.readContract({
    address: pool,
    abi: poolAbi,
    functionName: "binState",
    args: [activeBin],
  });
  if (activeState[2] <= 1000n || activeState[0] === 0n || activeState[1] === 0n)
    throw new Error("Active bin is not funded in both assets");
  for (const [index, address] of [token0, token1].entries()) {
    const expected = market.tokens[index];
    if (getAddress(address) !== getAddress(expected.address))
      throw new Error("Token ordering mismatch");
    const [symbol, name, decimals] = await Promise.all(
      ["symbol", "name", "decimals"].map((functionName) =>
        client.readContract({ address, abi: tokenAbi, functionName }),
      ),
    );
    if (
      symbol !== expected.symbol ||
      name !== expected.name ||
      decimals !== expected.decimals
    )
      throw new Error("Token metadata mismatch");
  }
  const receipts = [];
  for (const [name, record] of Object.entries(market.transactions)) {
    const receipt = await client.getTransactionReceipt({ hash: record.hash });
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    const transaction = await client.getTransaction({ hash: record.hash });
    if (
      receipt.status !== "success" ||
      receipt.blockHash !== block.hash ||
      receipt.blockHash !== record.blockHash ||
      receipt.gasUsed.toString() !== record.gasUsed
    )
      throw new Error(`Receipt validation failed: ${name}`);
    receipts.push({ name, receipt, block, transaction });
  }
  const sql = postgres(process.env.SUPABASE_DIRECT_DATABASE_URL, {
    max: 1,
    prepare: false,
    ssl: "require",
    idle_timeout: 5,
  });
  try {
    await sql.begin(async (tx) => {
      const assetIds = [];
      for (const token of market.tokens) {
        const rows =
          await tx`insert into zkblast_testnet.assets (chain_id,address,symbol,name,decimals,is_verified) values (46630,${token.address.toLowerCase()},${token.symbol},${token.name},${token.decimals},true) on conflict (chain_id,address) do update set symbol=excluded.symbol,name=excluded.name,decimals=excluded.decimals,is_verified=true,updated_at=now() returning id`;
        assetIds.push(rows[0].id);
      }
      const pools =
        await tx`insert into zkblast_testnet.pools (chain_id,address,pool_kind,token_x_id,token_y_id,fee_bps,status,created_block) values (46630,${pool.toLowerCase()},'dlmm',${assetIds[0]},${assetIds[1]},30,'active',${market.pool.createdBlock}) on conflict (chain_id,address) do update set pool_kind='dlmm',token_x_id=excluded.token_x_id,token_y_id=excluded.token_y_id,status='active',updated_at=now() returning id`;
      const poolId = pools[0].id;
      for (const { receipt, block, transaction } of receipts) {
        await tx`insert into zkblast_testnet.transactions (chain_id,transaction_hash,status,block_number,gas_used,effective_gas_price_wei) values (46630,${receipt.transactionHash.toLowerCase()},'confirmed',${receipt.blockNumber.toString()},${receipt.gasUsed.toString()},${receipt.effectiveGasPrice.toString()}) on conflict (chain_id,transaction_hash) do update set status='confirmed',block_number=excluded.block_number,gas_used=excluded.gas_used,effective_gas_price_wei=excluded.effective_gas_price_wei,updated_at=now()`;
        for (const log of receipt.logs) {
          if (getAddress(log.address) !== pool) continue;
          let event;
          try {
            event = decodeEventLog({
              abi: poolAbi,
              data: log.data,
              topics: log.topics,
            });
          } catch {
            continue;
          }
          if (event.eventName !== "Swap") continue;
          const swap = event.args;
          const wallets =
            await tx`select id,user_id from zkblast_testnet.user_wallets where wallet_address=${transaction.from.toLowerCase()} limit 1`;
          const wallet = wallets[0];
          await tx`insert into zkblast_testnet.swaps (pool_id,chain_id,transaction_hash,log_index,token_in_id,token_out_id,amount_in_raw,amount_out_raw,fee_raw,block_number,block_hash,block_timestamp,canonical,user_id,wallet_id) values (${poolId},46630,${receipt.transactionHash.toLowerCase()},${log.logIndex},${assetIds[swap.token0ToToken1 ? 0 : 1]},${assetIds[swap.token0ToToken1 ? 1 : 0]},${swap.amountIn.toString()},${swap.amountOut.toString()},${swap.protocolFee.toString()},${receipt.blockNumber.toString()},${block.hash.toLowerCase()},${new Date(Number(block.timestamp) * 1000)},true,${wallet?.user_id ?? null},${wallet?.id ?? null}) on conflict (chain_id,transaction_hash,log_index) do update set canonical=true,block_hash=excluded.block_hash,amount_in_raw=excluded.amount_in_raw,amount_out_raw=excluded.amount_out_raw`;
        }
      }
      const wallets =
        await tx`select id,user_id from zkblast_testnet.user_wallets where wallet_address=${market.owner.toLowerCase()} limit 1`;
      if (wallets[0]) {
        const managerAbi = parseAbi([
          "function positions(uint256) view returns(address owner,address pool,uint8 model,int24 binId,uint256 shares)",
        ]);
        for (const id of market.positionIds) {
          const value = await client.readContract({
            address: getAddress(deployment.integration.positionManager),
            abi: managerAbi,
            functionName: "positions",
            args: [BigInt(id)],
          });
          if (
            getAddress(value[0]) !== getAddress(market.owner) ||
            getAddress(value[1]) !== pool ||
            value[2] !== 1 ||
            value[4] === 0n
          )
            throw new Error("Onchain position mismatch");
          const created = receipts.find(
            (record) => record.name === `position:${value[3]}`,
          );
          if (!created) throw new Error("Position creation receipt missing");
          await tx`insert into zkblast_testnet.positions (user_id,wallet_id,pool_id,onchain_position_id,liquidity_raw,lower_bound,upper_bound,status,opened_at) values (${wallets[0].user_id},${wallets[0].id},${poolId},${id},${value[4].toString()},${value[3]},${value[3]},'open',${new Date(Number(created.block.timestamp) * 1000)}) on conflict (pool_id,onchain_position_id) do update set liquidity_raw=excluded.liquidity_raw,lower_bound=excluded.lower_bound,upper_bound=excluded.upper_bound,status='open',updated_at=now()`;
        }
      }
    });
    console.log(
      `Validated and registered DLMM ${pool}; ${receipts.length} confirmed receipts, canonical swap, and existing-user LP positions`,
    );
  } finally {
    await sql.end();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message.split("\n")[0]
      : "DLMM registration failed",
  );
  process.exitCode = 1;
});

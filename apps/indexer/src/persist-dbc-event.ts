import type postgres from "postgres";
import type { IndexedEvent } from "./domain.js";
import { dbcSwapFromEvent, validateDbcEvent } from "./dbc-projection.js";

function value(event: IndexedEvent, key: string): string {
  const result = event.payload[key];
  if (typeof result === "number" && Number.isSafeInteger(result) && result >= 0) {
    return result.toString();
  }
  if (typeof result !== "string") throw new Error(`INVALID_DBC_${key.toUpperCase()}`);
  return result.toLowerCase();
}
function rawValue(event: IndexedEvent, key: string): string {
  const result = event.payload[key];
  if (typeof result !== "string") throw new Error(`INVALID_DBC_${key.toUpperCase()}`);
  return result;
}
function booleanValue(event: IndexedEvent, key: string): boolean {
  const result = event.payload[key];
  if (typeof result !== "boolean") throw new Error(`INVALID_DBC_${key.toUpperCase()}`);
  return result;
}

export async function persistDbcEvent(
  sql: postgres.Sql | postgres.TransactionSql,
  schema: string,
  event: IndexedEvent,
  allowedContracts: ReadonlySet<string>,
): Promise<boolean> {
  if (event.kind !== "launch") return false;
  validateDbcEvent(event, { chainId: event.chainId, allowedContracts });
  const launchId = typeof event.payload.launchId === "string" ? value(event, "launchId") : null;
  const observedAt = new Date(Number(BigInt(value(event, "blockTimestamp"))) * 1_000);
  await sql.unsafe(
    `insert into ${schema}.dbc_events(chain_id,transaction_hash,log_index,block_number,block_hash,contract_address,event_name,launch_id,payload,canonical,observed_at)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9::text::jsonb,true,$10)
     on conflict(chain_id,transaction_hash,log_index) do update set block_number=excluded.block_number,block_hash=excluded.block_hash,
     contract_address=excluded.contract_address,event_name=excluded.event_name,launch_id=excluded.launch_id,payload=excluded.payload,canonical=true,observed_at=excluded.observed_at`,
    [event.chainId,event.transactionHash.toLowerCase(),event.logIndex,event.blockNumber.toString(),event.blockHash.toLowerCase(),
      event.contractAddress.toLowerCase(),event.eventName,launchId,JSON.stringify(event.payload),observedAt],
  );
  if (event.eventName === "Transfer") {
    const launches = await sql.unsafe<{ launch_id: string }[]>(
      `select launch_id from ${schema}.dbc_launches where token_address=$1 limit 1`,
      [event.contractAddress.toLowerCase()],
    );
    const tokenLaunchId = launches[0]?.launch_id;
    if (!tokenLaunchId) throw new Error("DBC_TRANSFER_TOKEN_NOT_REGISTERED");
    const from = value(event,"from"); const to = value(event,"to"); const amount = value(event,"value");
    const zero = "0x0000000000000000000000000000000000000000";
    if (from !== zero) await sql.unsafe(
      `update ${schema}.dbc_holder_balances set balance_raw=balance_raw-$3::numeric,updated_block=$4
       where launch_id=$1 and account=$2 and balance_raw >= $3::numeric`,
      [tokenLaunchId,from,amount,event.blockNumber.toString()],
    );
    if (to !== zero) await sql.unsafe(
      `insert into ${schema}.dbc_holder_balances(launch_id,account,balance_raw,updated_block) values($1,$2,$3,$4)
       on conflict(launch_id,account) do update set balance_raw=dbc_holder_balances.balance_raw+excluded.balance_raw,updated_block=excluded.updated_block`,
      [tokenLaunchId,to,amount,event.blockNumber.toString()],
    );
    return true;
  }
  const swap = dbcSwapFromEvent(event);
  if (swap) await sql.unsafe(
    `insert into ${schema}.dbc_swaps(chain_id,transaction_hash,log_index,launch_id,trader,recipient,is_buy,quote_amount_raw,base_amount_raw,fee_raw,price_x18,block_number,block_hash,observed_at,canonical)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true)
     on conflict(chain_id,transaction_hash,log_index) do update set block_number=excluded.block_number,block_hash=excluded.block_hash,canonical=true`,
    [event.chainId,event.transactionHash.toLowerCase(),event.logIndex,swap.launchId,value(event,"sender"),value(event,"recipient"),swap.isBuy,
      swap.quoteAmountRaw.toString(),swap.baseAmountRaw.toString(),swap.feeRaw.toString(),swap.priceX18.toString(),event.blockNumber.toString(),event.blockHash.toLowerCase(),swap.observedAt],
  );
  if (event.eventName === "CurveSwapExecuted") await sql.unsafe(
    `update ${schema}.dbc_launches set real_quote_reserve_raw=$2,base_sold_raw=$3,updated_block=$4,updated_at=now() where launch_id=$1`,
    [launchId,value(event,"realQuoteReserveRaw"),value(event,"baseSoldRaw"),event.blockNumber.toString()],
  );
  if (event.eventName === "LifecycleUpdated") await sql.unsafe(
    `update ${schema}.dbc_launches set lifecycle=$2,updated_block=$3,updated_at=now() where launch_id=$1`,
    [launchId,value(event,"nextLifecycle"),event.blockNumber.toString()],
  );
  if (event.eventName === "LaunchTemplateCreated") await sql.unsafe(
    `insert into ${schema}.dbc_templates(template_id,family_id,config_hash,version,enabled,used,updated_block)
     values($1,$2,$3,$4,true,false,$5) on conflict(template_id) do update set family_id=excluded.family_id,
     config_hash=excluded.config_hash,version=excluded.version,updated_block=excluded.updated_block`,
    [value(event,"templateId"),value(event,"familyId"),value(event,"configHash"),value(event,"version"),event.blockNumber.toString()],
  );
  if (event.eventName === "LaunchTemplateStatusUpdated") await sql.unsafe(
    `update ${schema}.dbc_templates set enabled=$2,updated_block=$3,updated_at=now() where template_id=$1`,
    [value(event,"templateId"),booleanValue(event,"enabled"),event.blockNumber.toString()],
  );
  if (event.eventName === "TokenLaunched") await sql.unsafe(
    `insert into ${schema}.dbc_launches(launch_id,template_id,creator,token_address,virtual_pool,quote_token,lifecycle,
      real_quote_reserve_raw,base_sold_raw,graduation_threshold_raw,created_block,updated_block)
     values($1,$2,$3,$4,$5,$6,1,0,0,$7,$8,$8) on conflict(launch_id) do update set updated_block=excluded.updated_block`,
    [launchId,value(event,"templateId"),value(event,"creator"),value(event,"token"),value(event,"virtualPool"),
      value(event,"quoteToken"),value(event,"graduationThresholdRaw"),event.blockNumber.toString()],
  );
  if (event.eventName === "LaunchMetadataPublished") await sql.unsafe(
    `update ${schema}.dbc_launches set name=$2,symbol=$3,metadata_uri=$4,updated_block=$5,updated_at=now() where launch_id=$1`,
    [launchId,rawValue(event,"name"),rawValue(event,"symbol"),rawValue(event,"metadataURI"),event.blockNumber.toString()],
  );
  if (event.eventName === "GraduationCompleted") await sql.unsafe(
    `insert into ${schema}.dbc_graduations(migration_id,launch_id,destination_pool,base_migrated_raw,quote_migrated_raw,destination_shares_raw,transaction_hash,block_number,observed_at)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(migration_id) do update set destination_pool=excluded.destination_pool,
     destination_shares_raw=excluded.destination_shares_raw,transaction_hash=excluded.transaction_hash,block_number=excluded.block_number,observed_at=excluded.observed_at`,
    [value(event,"migrationId"),launchId,value(event,"destinationPool"),value(event,"baseMigrated"),value(event,"quoteMigrated"),
      value(event,"destinationShares"),event.transactionHash.toLowerCase(),event.blockNumber.toString(),observedAt],
  );
  if (event.eventName === "AllocationRegistered") {
    const migrationId = value(event,"migrationId");
    const unlockAt = new Date(Number(BigInt(value(event,"creatorUnlockAt"))) * 1_000);
    await sql.unsafe(
      `insert into ${schema}.dbc_lp_allocations(migration_id,allocation_kind,recipient,shares_raw,unlock_at,updated_block)
       values($1,'creator',$2,$3,$4,$5),($1,'protocol',$6,$7,null,$5)
       on conflict(migration_id,allocation_kind) do update set shares_raw=excluded.shares_raw,unlock_at=excluded.unlock_at,updated_block=excluded.updated_block`,
      [migrationId,value(event,"creator"),value(event,"creatorShares"),unlockAt,event.blockNumber.toString(),value(event,"protocolRecipient"),value(event,"protocolShares")],
    );
  }
  if (event.eventName === "AllocationClaimed") await sql.unsafe(
    `update ${schema}.dbc_lp_allocations set claimed=true,claim_transaction_hash=$3,updated_block=$4
     where migration_id=$1 and allocation_kind=$2`,
    [value(event,"migrationId"),booleanValue(event,"creatorAllocation") ? "creator" : "protocol",event.transactionHash.toLowerCase(),event.blockNumber.toString()],
  );
  return true;
}

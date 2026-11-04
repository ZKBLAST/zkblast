import type postgres from "postgres";
import type { IndexedEvent } from "./domain.js";
import { protectedProjectionFromEvent } from "./protected-launch-projection.js";

function value(event: IndexedEvent, key: string): string {
  const item = event.payload[key];
  if (typeof item === "number" && Number.isSafeInteger(item) && item >= 0)
    return item.toString();
  if (typeof item !== "string") throw new Error(`INVALID_PROTECTED_${key.toUpperCase()}`);
  return item.toLowerCase();
}
function rawValue(event: IndexedEvent, key: string): string {
  const item = event.payload[key];
  if (typeof item !== "string") throw new Error(`INVALID_PROTECTED_${key.toUpperCase()}`);
  return item;
}
function bool(event: IndexedEvent, key: string): boolean {
  const item = event.payload[key];
  if (typeof item !== "boolean") throw new Error(`INVALID_PROTECTED_${key.toUpperCase()}`);
  return item;
}

export async function persistProtectedLaunchEvent(
  sql: postgres.Sql | postgres.TransactionSql,
  schema: string,
  event: IndexedEvent,
): Promise<boolean> {
  const projection = protectedProjectionFromEvent(event);
  const observedAt = new Date(Number(BigInt(value(event, "blockTimestamp"))) * 1_000);
  const receipt = [
    event.transactionHash.toLowerCase(), event.logIndex,
    event.blockNumber.toString(), event.blockHash.toLowerCase(), observedAt,
  ] as const;

  if (event.eventName === "ProtectionPolicyCreated") {
    await sql.unsafe(
      `insert into ${schema}.protected_launch_policies(chain_id,policy_id,family_id,policy_hash,version,protection_blocks,max_buy_bps_per_transaction,max_buy_bps_per_address,initial_fee_bps,base_fee_bps,lp_lock_seconds,enabled,used,transaction_hash,log_index,block_number,block_hash,canonical,observed_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,false,$12,$13,$14,$15,true,$16)
       on conflict(chain_id,policy_id) do update set policy_hash=excluded.policy_hash,version=excluded.version,canonical=true,block_number=excluded.block_number,block_hash=excluded.block_hash,observed_at=excluded.observed_at`,
      [event.chainId,value(event,"policyId"),value(event,"familyId"),value(event,"policyHash"),value(event,"version"),value(event,"protectionBlocks"),value(event,"maxBuyBpsPerTransaction"),value(event,"maxBuyBpsPerAddress"),value(event,"initialFeeBps"),value(event,"baseFeeBps"),value(event,"lpLockSeconds"),...receipt],
    );
    return true;
  }
  if (event.eventName === "ProtectionPolicyStatusUpdated" || event.eventName === "ProtectionPolicyUsed") {
    if (event.eventName === "ProtectionPolicyUsed") {
      await sql.unsafe(
        `update ${schema}.protected_launch_policies set used=true,transaction_hash=$3,log_index=$4,block_number=$5,block_hash=$6,canonical=true,observed_at=$7 where chain_id=$1 and policy_id=$2`,
        [event.chainId,value(event,"policyId"),...receipt],
      );
    } else {
      await sql.unsafe(
        `update ${schema}.protected_launch_policies set enabled=$3,transaction_hash=$4,log_index=$5,block_number=$6,block_hash=$7,canonical=true,observed_at=$8 where chain_id=$1 and policy_id=$2`,
        [event.chainId,value(event,"policyId"),bool(event,"enabled"),...receipt],
      );
    }
    return true;
  }
  if (event.eventName === "ProtectedTokenLaunched") {
    await sql.unsafe(
      `insert into ${schema}.protected_launches(chain_id,launch_id,template_id,policy_id,policy_hash,creator_address,token_address,pool_address,quote_token_address,protection_start_block,transaction_hash,log_index,block_number,block_hash,canonical,observed_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true,$15)
       on conflict(chain_id,launch_id) do update set policy_hash=excluded.policy_hash,token_address=excluded.token_address,pool_address=excluded.pool_address,canonical=true,block_number=excluded.block_number,block_hash=excluded.block_hash,observed_at=excluded.observed_at`,
      [event.chainId,value(event,"launchId"),value(event,"templateId"),value(event,"policyId"),value(event,"policyHash"),value(event,"creator"),value(event,"token"),value(event,"virtualPool"),value(event,"quoteToken"),value(event,"protectionStartBlock"),...receipt],
    );
    await sql.unsafe(
      `insert into ${schema}.dbc_launches(chain_id,launch_id,template_id,creator,token_address,virtual_pool,quote_token,lifecycle,real_quote_reserve_raw,base_sold_raw,created_block,updated_block)
       values($1,$2,$3,$4,$5,$6,$7,1,0,0,$8,$8)
       on conflict(launch_id) do update set token_address=excluded.token_address,virtual_pool=excluded.virtual_pool,quote_token=excluded.quote_token,updated_block=excluded.updated_block,updated_at=now()`,
      [event.chainId,value(event,"launchId"),value(event,"templateId"),value(event,"creator"),value(event,"token"),value(event,"virtualPool"),value(event,"quoteToken"),event.blockNumber.toString()],
    );
    return true;
  }
  if (event.eventName === "ProtectedLaunchMetadataPublished") {
    await sql.unsafe(
      `update ${schema}.dbc_launches set name=$3,symbol=$4,metadata_uri=$5,updated_block=$6,updated_at=now()
       where chain_id=$1 and launch_id=$2`,
      [event.chainId,value(event,"launchId"),rawValue(event,"name"),rawValue(event,"symbol"),rawValue(event,"metadataURI"),event.blockNumber.toString()],
    );
    return true;
  }
  if (event.eventName === "ProtectedPurchaseRecorded") {
    await sql.unsafe(
      `insert into ${schema}.protected_buy_allocations(chain_id,launch_id,buyer_address,purchased_raw,last_transaction_hash,last_log_index,last_block_number,last_block_hash,canonical,updated_at)
       select $1,launch_id,$2,$3,$4,$5,$6,$7,true,$8 from ${schema}.protected_launches where chain_id=$1 and token_address=$9 and canonical=true
       on conflict(chain_id,launch_id,buyer_address) do update set purchased_raw=excluded.purchased_raw,last_transaction_hash=excluded.last_transaction_hash,last_log_index=excluded.last_log_index,last_block_number=excluded.last_block_number,last_block_hash=excluded.last_block_hash,canonical=true,updated_at=excluded.updated_at`,
      [event.chainId,value(event,"buyer"),value(event,"cumulativeAmount"),...receipt,event.contractAddress.toLowerCase()],
    );
    return true;
  }
  if (event.eventName === "ProtectedAllocationRegistered") {
    const isDlmm = bool(event,"isDlmm");
    await sql.unsafe(
      `insert into ${schema}.protected_lp_allocations(chain_id,migration_id,launch_id,pool_address,creator_address,protocol_recipient,creator_shares,protocol_shares,creator_unlock_at,is_dlmm,bin_id,transaction_hash,log_index,block_number,block_hash,canonical,observed_at)
       select $1,$2,launch_id,$3,$4,$5,$6,$7,to_timestamp($8),$9,$10,$11,$12,$13,$14,true,$15 from ${schema}.protected_graduation_migrations where chain_id=$1 and migration_id=$2
       on conflict(chain_id,migration_id) do update set creator_shares=excluded.creator_shares,protocol_shares=excluded.protocol_shares,creator_unlock_at=excluded.creator_unlock_at,canonical=true,block_number=excluded.block_number,block_hash=excluded.block_hash,observed_at=excluded.observed_at`,
      [event.chainId,value(event,"migrationId"),value(event,"pool"),value(event,"creator"),value(event,"protocolRecipient"),value(event,"creatorShares"),value(event,"protocolShares"),value(event,"creatorUnlockAt"),isDlmm,isDlmm ? value(event,"binId") : null,...receipt],
    );
    return true;
  }
  if (event.eventName === "ProtectedAllocationClaimed") {
    await sql.unsafe(
      `update ${schema}.protected_lp_allocations set ${bool(event,"creatorAllocation") ? "creator_claimed=true" : "protocol_claimed=true"},transaction_hash=$3,log_index=$4,block_number=$5,block_hash=$6,canonical=true,observed_at=$7 where chain_id=$1 and migration_id=$2`,
      [event.chainId,value(event,"migrationId"),...receipt],
    );
    return true;
  }
  if (event.eventName === "ProtectedLaunchIdentityRegistered") {
    await sql.unsafe(
      `insert into ${schema}.protected_launch_identities(chain_id,launch_id,canonical_hash,name_commitment,symbol_commitment,metadata_hash,social_hash,token_runtime_code_hash,launchpad_id,token_template_version,duplicate_name,duplicate_symbol,transaction_hash,log_index,block_number,block_hash,canonical,observed_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,true,$17)
       on conflict(chain_id,launch_id) do update set canonical_hash=excluded.canonical_hash,name_commitment=excluded.name_commitment,symbol_commitment=excluded.symbol_commitment,metadata_hash=excluded.metadata_hash,social_hash=excluded.social_hash,token_runtime_code_hash=excluded.token_runtime_code_hash,launchpad_id=excluded.launchpad_id,token_template_version=excluded.token_template_version,duplicate_name=excluded.duplicate_name,duplicate_symbol=excluded.duplicate_symbol,transaction_hash=excluded.transaction_hash,log_index=excluded.log_index,block_number=excluded.block_number,block_hash=excluded.block_hash,canonical=true,observed_at=excluded.observed_at`,
      [event.chainId,value(event,"launchId"),value(event,"canonicalHash"),value(event,"nameCommitment"),value(event,"symbolCommitment"),value(event,"metadataHash"),value(event,"socialHash"),value(event,"tokenRuntimeCodeHash"),value(event,"launchpadId"),value(event,"tokenTemplateVersion"),bool(event,"duplicateName"),bool(event,"duplicateSymbol"),...receipt],
    );
    return true;
  }
  if (event.eventName === "ProtectedLaunchIdentityBoundToLaunchpad") {
    await sql.unsafe(
      `update ${schema}.protected_launch_identities
       set launchpad_id=$3,canonical_hash=$4,transaction_hash=$5,log_index=$6,block_number=$7,block_hash=$8,canonical=true,observed_at=$9
       where chain_id=$1 and launch_id=$2`,
      [event.chainId,value(event,"launchId"),value(event,"launchpadId"),value(event,"canonicalHash"),...receipt],
    );
    await sql.unsafe(
      `update ${schema}.dbc_launches
       set launchpad_bound=true,launchpad_id=$3,updated_block=$4,updated_at=now()
       where chain_id=$1 and launch_id=$2`,
      [event.chainId,value(event,"launchId"),value(event,"launchpadId"),event.blockNumber.toString()],
    );
    return true;
  }
  if (event.eventName === "LifecycleUpdated") {
    await sql.unsafe(
      `update ${schema}.protected_launches set lifecycle=$3,transaction_hash=$4,log_index=$5,block_number=$6,block_hash=$7,canonical=true,observed_at=$8
       where chain_id=$1 and launch_id=$2`,
      [event.chainId,value(event,"launchId"),value(event,"nextLifecycle"),...receipt],
    );
  }
  if (event.eventName === "GraduationAttemptStarted") {
    await sql.unsafe(
      `insert into ${schema}.protected_graduation_migrations(chain_id,migration_id,launch_id,source_pool_address,adapter_address,status,attempts,last_block_number,last_block_hash,canonical,updated_at)
       select $1,$2,$3,$4,$5,2,$6,$7,$8,true,$9 where exists(select 1 from ${schema}.protected_launches where chain_id=$1 and launch_id=$3)
       on conflict(chain_id,migration_id) do update set status=2,attempts=excluded.attempts,last_failure_hash=null,last_block_number=excluded.last_block_number,last_block_hash=excluded.last_block_hash,canonical=true,updated_at=excluded.updated_at`,
      [event.chainId,value(event,"migrationId"),value(event,"launchId"),value(event,"sourcePool"),value(event,"adapter"),value(event,"attempt"),event.blockNumber.toString(),event.blockHash.toLowerCase(),observedAt],
    );
    return true;
  }
  if (event.eventName === "GraduationAttemptPending" || event.eventName === "GraduationNeedsReview") {
    await sql.unsafe(
      `update ${schema}.protected_graduation_migrations set status=$3,attempts=$4,last_failure_hash=$5,last_block_number=$6,last_block_hash=$7,canonical=true,updated_at=$8 where chain_id=$1 and migration_id=$2`,
      [event.chainId,value(event,"migrationId"),event.eventName === "GraduationNeedsReview" ? 5 : 3,value(event,event.eventName === "GraduationNeedsReview" ? "attempts" : "attempt"),value(event,"failureHash"),event.blockNumber.toString(),event.blockHash.toLowerCase(),observedAt],
    );
    return true;
  }
  if (event.eventName === "GraduationCompleted") {
    await sql.unsafe(
      `update ${schema}.protected_graduation_migrations set destination_pool_address=$3,destination_shares=$4,status=4,last_failure_hash=null,last_block_number=$5,last_block_hash=$6,canonical=true,updated_at=$7 where chain_id=$1 and migration_id=$2`,
      [event.chainId,value(event,"migrationId"),value(event,"destinationPool"),value(event,"destinationShares"),event.blockNumber.toString(),event.blockHash.toLowerCase(),observedAt],
    );
    await sql.unsafe(
      `update ${schema}.protected_launches set lifecycle=4,transaction_hash=$3,log_index=$4,block_number=$5,block_hash=$6,canonical=true,observed_at=$7
       where chain_id=$1 and launch_id=$2`,
      [event.chainId,value(event,"launchId"),...receipt],
    );
    const allocations = await sql.unsafe<{ allocated_shares: string }[]>(
      `select (creator_shares+protocol_shares)::text allocated_shares
       from ${schema}.protected_lp_allocations where chain_id=$1 and migration_id=$2 and canonical limit 1`,
      [event.chainId,value(event,"migrationId")],
    );
    if (allocations[0]) {
      await reconcileProtectedGraduationAccounting(sql, schema, {
        chainId: event.chainId,
        migrationId: value(event,"migrationId"),
        launchId: value(event,"launchId"),
        destinationShares: BigInt(value(event,"destinationShares")),
        allocatedShares: BigInt(allocations[0].allocated_shares),
        detectedBlock: event.blockNumber,
        detectedAt: observedAt,
      });
    }
    return true;
  }
  return projection !== null;
}

export async function reconcileProtectedGraduationAccounting(
  sql: postgres.Sql | postgres.TransactionSql,
  schema: string,
  input: {
    chainId: number;
    migrationId: string;
    launchId: string;
    destinationShares: bigint;
    allocatedShares: bigint;
    detectedBlock: bigint;
    detectedAt: Date;
  },
): Promise<boolean> {
  const reconciles = input.destinationShares === input.allocatedShares;
  const alertId = `${input.migrationId.toLowerCase()}:migration-accounting`;

  await sql.unsafe(
    `update ${schema}.protected_graduation_migrations
     set accounting_reconciles=$3,updated_at=$4
     where chain_id=$1 and migration_id=$2 and canonical=true`,
    [input.chainId,input.migrationId.toLowerCase(),reconciles,input.detectedAt],
  );

  if (reconciles) {
    await sql.unsafe(
      `update ${schema}.protected_invariant_alerts
       set resolved=true,details=$4::jsonb,detected_block=$5,detected_at=$6
       where chain_id=$1 and alert_id=$2 and migration_id=$3`,
      [input.chainId,alertId,input.migrationId.toLowerCase(),JSON.stringify({
        destinationShares: input.destinationShares.toString(),
        allocatedShares: input.allocatedShares.toString(),
      }),input.detectedBlock.toString(),input.detectedAt],
    );
    return true;
  }

  await sql.unsafe(
    `insert into ${schema}.protected_invariant_alerts(chain_id,alert_id,launch_id,migration_id,invariant_code,severity,details,resolved,detected_block,detected_at)
     values($1,$2,$3,$4,'MIGRATION_ACCOUNTING_MISMATCH','critical',$5::jsonb,false,$6,$7)
     on conflict(chain_id,alert_id) do update set details=excluded.details,resolved=false,detected_block=excluded.detected_block,detected_at=excluded.detected_at`,
    [input.chainId,alertId,input.launchId.toLowerCase(),input.migrationId.toLowerCase(),JSON.stringify({
      destinationShares: input.destinationShares.toString(),
      allocatedShares: input.allocatedShares.toString(),
    }),input.detectedBlock.toString(),input.detectedAt],
  );
  return false;
}

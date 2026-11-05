import type postgres from "postgres";
import type { IndexedEvent } from "./domain.js";
import {
  dbcLaunchBindingFromEvent,
  dbcSwapFromEvent,
  validateDbcEvent,
} from "./dbc-projection.js";
import { persistProtectedLaunchEvent } from "./persist-protected-launch-event.js";

const stockQuoteOnlyEventNames = new Set([
  "QuoteAssetListed",
  "QuoteAssetConfigUpdated",
  "QuoteAssetDisabled",
  "SessionPolicyUpdated",
  "DestinationCapabilityRegistered",
  "DestinationCapabilityAccepted",
  "DestinationCapabilityDisabled",
]);

export function isStockQuoteOnlyEvent(eventName: string): boolean {
  return stockQuoteOnlyEventNames.has(eventName);
}

function value(event: IndexedEvent, key: string): string {
  const result = event.payload[key];
  if (
    typeof result === "number" &&
    Number.isSafeInteger(result) &&
    result >= 0
  ) {
    return result.toString();
  }
  if (typeof result !== "string")
    throw new Error(`INVALID_DBC_${key.toUpperCase()}`);
  return result.toLowerCase();
}
function rawValue(event: IndexedEvent, key: string): string {
  const result = event.payload[key];
  if (typeof result !== "string")
    throw new Error(`INVALID_DBC_${key.toUpperCase()}`);
  return result;
}
function booleanValue(event: IndexedEvent, key: string): boolean {
  const result = event.payload[key];
  if (typeof result !== "boolean")
    throw new Error(`INVALID_DBC_${key.toUpperCase()}`);
  return result;
}

function optionalValue(event: IndexedEvent, key: string): string | null {
  return event.payload[key] === undefined ? null : value(event, key);
}

export async function persistDbcEvent(
  sql: postgres.Sql | postgres.TransactionSql,
  schema: string,
  event: IndexedEvent,
  allowedContracts: ReadonlySet<string>,
): Promise<boolean> {
  if (event.kind !== "launch") return false;
  // Stock-quote registry events share the launch classification so they remain
  // visible in the unified activity stream, but they are projected by
  // persistStockQuoteEvent rather than the DBC launch projector.
  if (isStockQuoteOnlyEvent(event.eventName)) return false;
  validateDbcEvent(event, { chainId: event.chainId, allowedContracts });
  const launchId =
    typeof event.payload.launchId === "string"
      ? value(event, "launchId")
      : null;
  const observedAt = new Date(
    Number(BigInt(value(event, "blockTimestamp"))) * 1_000,
  );
  await sql.unsafe(
    `insert into ${schema}.dbc_events(chain_id,transaction_hash,log_index,block_number,block_hash,contract_address,event_name,launch_id,payload,canonical,observed_at)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9::text::jsonb,true,$10)
     on conflict(chain_id,transaction_hash,log_index) do update set block_number=excluded.block_number,block_hash=excluded.block_hash,
     contract_address=excluded.contract_address,event_name=excluded.event_name,launch_id=excluded.launch_id,payload=excluded.payload,canonical=true,observed_at=excluded.observed_at`,
    [
      event.chainId,
      event.transactionHash.toLowerCase(),
      event.logIndex,
      event.blockNumber.toString(),
      event.blockHash.toLowerCase(),
      event.contractAddress.toLowerCase(),
      event.eventName,
      launchId,
      JSON.stringify(event.payload),
      observedAt,
    ],
  );
  if (await persistProtectedLaunchEvent(sql, schema, event)) return true;
  if (event.eventName === "LaunchpadCreated") {
    const owner = value(event, "owner");
    await sql.unsafe(
      `insert into ${schema}.launchpads(chain_id,launchpad_id,owner_address,treasury_address,operator_address,metadata_hash,slug_commitment,config_preset_id,version,status,created_block,updated_block,transaction_hash)
       values($1,$2,$3,$4,$3,$5,$6,$7,$8,1,$9,$9,$10)
       on conflict(chain_id,launchpad_id) do update set owner_address=excluded.owner_address,treasury_address=excluded.treasury_address,
       operator_address=excluded.operator_address,metadata_hash=excluded.metadata_hash,slug_commitment=excluded.slug_commitment,
       config_preset_id=excluded.config_preset_id,version=excluded.version,status=excluded.status,updated_block=excluded.updated_block,
       transaction_hash=excluded.transaction_hash,updated_at=now()`,
      [
        event.chainId,
        value(event, "launchpadId"),
        owner,
        value(event, "treasury"),
        value(event, "metadataHash"),
        value(event, "slugCommitment"),
        value(event, "configPresetId"),
        value(event, "version"),
        event.blockNumber.toString(),
        event.transactionHash.toLowerCase(),
      ],
    );
    return true;
  }
  if (event.eventName === "LaunchpadMetadataUpdated") {
    await sql.unsafe(
      `insert into ${schema}.launchpad_metadata_revisions(chain_id,launchpad_id,version,previous_metadata_hash,metadata_hash,transaction_hash,block_number,observed_at)
       values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(chain_id,launchpad_id,version) do update set
       previous_metadata_hash=excluded.previous_metadata_hash,metadata_hash=excluded.metadata_hash,transaction_hash=excluded.transaction_hash,
       block_number=excluded.block_number,observed_at=excluded.observed_at`,
      [
        event.chainId,
        value(event, "launchpadId"),
        value(event, "version"),
        value(event, "previousMetadataHash"),
        value(event, "metadataHash"),
        event.transactionHash.toLowerCase(),
        event.blockNumber.toString(),
        observedAt,
      ],
    );
    await sql.unsafe(
      `update ${schema}.launchpads set metadata_hash=$3,version=$4,updated_block=$5,transaction_hash=$6,updated_at=now() where chain_id=$1 and launchpad_id=$2`,
      [
        event.chainId,
        value(event, "launchpadId"),
        value(event, "metadataHash"),
        value(event, "version"),
        event.blockNumber.toString(),
        event.transactionHash.toLowerCase(),
      ],
    );
    return true;
  }
  const launchpadId =
    typeof event.payload.launchpadId === "string"
      ? value(event, "launchpadId")
      : null;
  if (launchpadId && event.eventName === "LaunchpadOperatorUpdated")
    await sql.unsafe(
      `update ${schema}.launchpads set operator_address=$3,updated_block=$4,transaction_hash=$5,updated_at=now() where chain_id=$1 and launchpad_id=$2`,
      [
        event.chainId,
        launchpadId,
        value(event, "operator"),
        event.blockNumber.toString(),
        event.transactionHash.toLowerCase(),
      ],
    );
  if (launchpadId && event.eventName === "LaunchpadOwnerProposed")
    await sql.unsafe(
      `update ${schema}.launchpads set pending_owner_address=$3,updated_block=$4,transaction_hash=$5,updated_at=now() where chain_id=$1 and launchpad_id=$2`,
      [
        event.chainId,
        launchpadId,
        value(event, "pendingOwner"),
        event.blockNumber.toString(),
        event.transactionHash.toLowerCase(),
      ],
    );
  if (launchpadId && event.eventName === "LaunchpadOwnerProposalCancelled")
    await sql.unsafe(
      `update ${schema}.launchpads set pending_owner_address=null,updated_block=$3,transaction_hash=$4,updated_at=now() where chain_id=$1 and launchpad_id=$2`,
      [
        event.chainId,
        launchpadId,
        event.blockNumber.toString(),
        event.transactionHash.toLowerCase(),
      ],
    );
  if (launchpadId && event.eventName === "LaunchpadOwnerAccepted")
    await sql.unsafe(
      `update ${schema}.launchpads set owner_address=$3,pending_owner_address=null,updated_block=$4,transaction_hash=$5,updated_at=now() where chain_id=$1 and launchpad_id=$2`,
      [
        event.chainId,
        launchpadId,
        value(event, "owner"),
        event.blockNumber.toString(),
        event.transactionHash.toLowerCase(),
      ],
    );
  if (launchpadId && event.eventName === "LaunchpadTreasuryProposed")
    await sql.unsafe(
      `update ${schema}.launchpads set pending_treasury_address=$3,updated_block=$4,transaction_hash=$5,updated_at=now() where chain_id=$1 and launchpad_id=$2`,
      [
        event.chainId,
        launchpadId,
        value(event, "pendingTreasury"),
        event.blockNumber.toString(),
        event.transactionHash.toLowerCase(),
      ],
    );
  if (launchpadId && event.eventName === "LaunchpadTreasuryProposalCancelled")
    await sql.unsafe(
      `update ${schema}.launchpads set pending_treasury_address=null,updated_block=$3,transaction_hash=$4,updated_at=now() where chain_id=$1 and launchpad_id=$2`,
      [
        event.chainId,
        launchpadId,
        event.blockNumber.toString(),
        event.transactionHash.toLowerCase(),
      ],
    );
  if (launchpadId && event.eventName === "LaunchpadTreasuryAccepted")
    await sql.unsafe(
      `update ${schema}.launchpads set treasury_address=$3,pending_treasury_address=null,updated_block=$4,transaction_hash=$5,updated_at=now() where chain_id=$1 and launchpad_id=$2`,
      [
        event.chainId,
        launchpadId,
        value(event, "treasury"),
        event.blockNumber.toString(),
        event.transactionHash.toLowerCase(),
      ],
    );
  if (launchpadId && event.eventName === "LaunchpadStatusUpdated")
    await sql.unsafe(
      `update ${schema}.launchpads set status=$3,updated_block=$4,transaction_hash=$5,updated_at=now() where chain_id=$1 and launchpad_id=$2`,
      [
        event.chainId,
        launchpadId,
        value(event, "status"),
        event.blockNumber.toString(),
        event.transactionHash.toLowerCase(),
      ],
    );
  if (launchpadId && event.eventName === "LaunchpadFeePolicyUpdated") {
    const shares = event.payload.shares;
    if (typeof shares !== "string") throw new Error("INVALID_DBC_SHARES");
    const parsed = JSON.parse(shares) as unknown;
    const shareKeys = [
      "protocolShareBps",
      "operatorShareBps",
      "creatorShareBps",
      "referralShareBps",
    ] as const;
    const share = (key: (typeof shareKeys)[number]) => {
      const index = shareKeys.indexOf(key);
      const amount = Array.isArray(parsed)
        ? parsed[index]
        : parsed && typeof parsed === "object"
          ? (parsed as Record<string, unknown>)[key]
          : undefined;
      if (
        typeof amount === "number" &&
        Number.isSafeInteger(amount) &&
        amount >= 0
      )
        return amount.toString();
      if (typeof amount === "string" && /^\d+$/u.test(amount)) return amount;
      throw new Error("INVALID_DBC_SHARES");
    };
    await sql.unsafe(
      `insert into ${schema}.launchpad_fee_policies(chain_id,launchpad_id,version,total_trade_fee_bps,protocol_share_bps,operator_share_bps,creator_share_bps,referral_share_bps,operator_recipient,transaction_hash,updated_block)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict(chain_id,launchpad_id) do update set version=excluded.version,
       total_trade_fee_bps=excluded.total_trade_fee_bps,protocol_share_bps=excluded.protocol_share_bps,operator_share_bps=excluded.operator_share_bps,
       creator_share_bps=excluded.creator_share_bps,referral_share_bps=excluded.referral_share_bps,operator_recipient=excluded.operator_recipient,
       transaction_hash=excluded.transaction_hash,updated_block=excluded.updated_block,updated_at=now()`,
      [
        event.chainId,
        launchpadId,
        value(event, "version"),
        value(event, "totalTradeFeeBps"),
        share("protocolShareBps"),
        share("operatorShareBps"),
        share("creatorShareBps"),
        share("referralShareBps"),
        value(event, "operatorRecipient"),
        event.transactionHash.toLowerCase(),
        event.blockNumber.toString(),
      ],
    );
  }
  if (launchpadId && event.eventName === "FeePolicySnapshotted")
    await sql.unsafe(
      `insert into ${schema}.launchpad_fee_snapshots(chain_id,snapshot_id,launchpad_id,pool_address,policy_version,transaction_hash,updated_block)
       values($1,$2,$3,$4,$5,$6,$7) on conflict(chain_id,snapshot_id) do update set policy_version=excluded.policy_version,
       transaction_hash=excluded.transaction_hash,updated_block=excluded.updated_block,updated_at=now()`,
      [
        event.chainId,
        value(event, "snapshotId"),
        launchpadId,
        value(event, "pool"),
        value(event, "policyVersion"),
        event.transactionHash.toLowerCase(),
        event.blockNumber.toString(),
      ],
    );
  if (event.eventName === "RevenueSnapshotRegistered")
    await sql.unsafe(
      `update ${schema}.launchpad_fee_snapshots set asset_address=$3,updated_block=$4,transaction_hash=$5,updated_at=now() where chain_id=$1 and snapshot_id=$2`,
      [
        event.chainId,
        value(event, "snapshotId"),
        value(event, "asset"),
        event.blockNumber.toString(),
        event.transactionHash.toLowerCase(),
      ],
    );
  if (event.eventName === "Transfer") {
    const launches = await sql.unsafe<{ launch_id: string }[]>(
      `select launch_id from ${schema}.dbc_launches where token_address=$1 limit 1`,
      [event.contractAddress.toLowerCase()],
    );
    const tokenLaunchId = launches[0]?.launch_id;
    if (!tokenLaunchId) {
      const protectedLaunches = await sql.unsafe<{ launch_id: string }[]>(
        `select launch_id from ${schema}.protected_launches where chain_id=$1 and token_address=$2 and canonical limit 1`,
        [event.chainId, event.contractAddress.toLowerCase()],
      );
      if (protectedLaunches.length > 0) return true;
      throw new Error("DBC_TRANSFER_TOKEN_NOT_REGISTERED");
    }
    const from = value(event, "from");
    const to = value(event, "to");
    const amount = value(event, "value");
    const zero = "0x0000000000000000000000000000000000000000";
    if (from !== zero)
      await sql.unsafe(
        `update ${schema}.dbc_holder_balances set balance_raw=balance_raw-$3::numeric,updated_block=$4
       where launch_id=$1 and account=$2 and balance_raw >= $3::numeric`,
        [tokenLaunchId, from, amount, event.blockNumber.toString()],
      );
    if (to !== zero)
      await sql.unsafe(
        `insert into ${schema}.dbc_holder_balances(launch_id,account,balance_raw,updated_block) values($1,$2,$3,$4)
       on conflict(launch_id,account) do update set balance_raw=dbc_holder_balances.balance_raw+excluded.balance_raw,updated_block=excluded.updated_block`,
        [tokenLaunchId, to, amount, event.blockNumber.toString()],
      );
    return true;
  }
  const swap = dbcSwapFromEvent(event);
  if (swap)
    await sql.unsafe(
      `insert into ${schema}.dbc_swaps(chain_id,transaction_hash,log_index,launch_id,trader,recipient,is_buy,quote_amount_raw,base_amount_raw,fee_raw,price_x18,block_number,block_hash,observed_at,canonical)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true)
     on conflict(chain_id,transaction_hash,log_index) do update set block_number=excluded.block_number,block_hash=excluded.block_hash,canonical=true`,
      [
        event.chainId,
        event.transactionHash.toLowerCase(),
        event.logIndex,
        swap.launchId,
        value(event, "sender"),
        value(event, "recipient"),
        swap.isBuy,
        swap.quoteAmountRaw.toString(),
        swap.baseAmountRaw.toString(),
        swap.feeRaw.toString(),
        swap.priceX18.toString(),
        event.blockNumber.toString(),
        event.blockHash.toLowerCase(),
        swap.observedAt,
      ],
    );
  if (event.eventName === "CurveSwapExecuted")
    await sql.unsafe(
      `update ${schema}.dbc_launches set real_quote_reserve_raw=$2,base_sold_raw=$3,updated_block=$4,updated_at=now() where launch_id=$1`,
      [
        launchId,
        value(event, "realQuoteReserveRaw"),
        value(event, "baseSoldRaw"),
        event.blockNumber.toString(),
      ],
    );
  if (event.eventName === "LifecycleUpdated")
    await sql.unsafe(
      `update ${schema}.dbc_launches set lifecycle=$2,updated_block=$3,updated_at=now() where launch_id=$1`,
      [launchId, value(event, "nextLifecycle"), event.blockNumber.toString()],
    );
  if (event.eventName === "LaunchTemplateCreated")
    await sql.unsafe(
      `insert into ${schema}.dbc_templates(template_id,family_id,config_hash,version,enabled,used,updated_block)
     values($1,$2,$3,$4,true,false,$5) on conflict(template_id) do update set family_id=excluded.family_id,
     config_hash=excluded.config_hash,version=excluded.version,updated_block=excluded.updated_block`,
      [
        value(event, "templateId"),
        value(event, "familyId"),
        value(event, "configHash"),
        value(event, "version"),
        event.blockNumber.toString(),
      ],
    );
  if (event.eventName === "LaunchTemplateStatusUpdated")
    await sql.unsafe(
      `update ${schema}.dbc_templates set enabled=$2,updated_block=$3,updated_at=now() where template_id=$1`,
      [
        value(event, "templateId"),
        booleanValue(event, "enabled"),
        event.blockNumber.toString(),
      ],
    );
  if (event.eventName === "TokenLaunched")
    await sql.unsafe(
      `insert into ${schema}.dbc_launches(launch_id,template_id,creator,token_address,virtual_pool,quote_token,lifecycle,
      real_quote_reserve_raw,base_sold_raw,graduation_threshold_raw,created_block,updated_block)
     values($1,$2,$3,$4,$5,$6,1,0,0,$7,$8,$8) on conflict(launch_id) do update set updated_block=excluded.updated_block`,
      [
        launchId,
        value(event, "templateId"),
        value(event, "creator"),
        value(event, "token"),
        value(event, "virtualPool"),
        value(event, "quoteToken"),
        value(event, "graduationThresholdRaw"),
        event.blockNumber.toString(),
      ],
    );
  if (event.eventName === "LaunchMetadataPublished")
    await sql.unsafe(
      `update ${schema}.dbc_launches set name=$3,symbol=$4,metadata_uri=$5,updated_block=$6,updated_at=now() where chain_id=$1 and launch_id=$2`,
      [
        event.chainId,
        launchId,
        rawValue(event, "name"),
        rawValue(event, "symbol"),
        rawValue(event, "metadataURI"),
        event.blockNumber.toString(),
      ],
    );
  if (event.eventName === "GraduationReady")
    await sql.unsafe(
      `insert into ${schema}.dbc_graduation_readiness(chain_id,launch_id,real_quote_reserve_raw,threshold_raw,transaction_hash,log_index,block_number,observed_at)
       values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(chain_id,launch_id) do update set
       real_quote_reserve_raw=excluded.real_quote_reserve_raw,threshold_raw=excluded.threshold_raw,
       transaction_hash=excluded.transaction_hash,log_index=excluded.log_index,block_number=excluded.block_number,observed_at=excluded.observed_at`,
      [
        event.chainId,
        launchId,
        value(event, "realQuoteReserveRaw"),
        value(event, "thresholdRaw"),
        event.transactionHash.toLowerCase(),
        event.logIndex,
        event.blockNumber.toString(),
        observedAt,
      ],
    );
  if (event.eventName === "GraduationReady")
    await sql.unsafe(
      `update ${schema}.dbc_launches set graduation_threshold_raw=$3,lifecycle=3,updated_block=$4,updated_at=now()
       where chain_id=$1 and launch_id=$2`,
      [event.chainId, launchId, value(event, "thresholdRaw"), event.blockNumber.toString()],
    );
  if (event.eventName === "FeeClaimed")
    await sql.unsafe(
      `insert into ${schema}.launchpad_fee_claim_receipts(chain_id,transaction_hash,log_index,launch_id,snapshot_id,launchpad_id,recipient_address,pool_address,asset_address,allocation,amount_raw,block_number,observed_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict(chain_id,transaction_hash,log_index) do update set launch_id=excluded.launch_id,snapshot_id=excluded.snapshot_id,
       launchpad_id=excluded.launchpad_id,recipient_address=excluded.recipient_address,pool_address=excluded.pool_address,
       asset_address=excluded.asset_address,allocation=excluded.allocation,amount_raw=excluded.amount_raw,
       block_number=excluded.block_number,observed_at=excluded.observed_at`,
      [
        event.chainId,
        event.transactionHash.toLowerCase(),
        event.logIndex,
        launchId,
        optionalValue(event, "snapshotId"),
        optionalValue(event, "launchpadId"),
        value(event, "recipient"),
        optionalValue(event, "pool"),
        optionalValue(event, "asset"),
        optionalValue(event, "allocation"),
        value(event, event.payload.amountRaw === undefined ? "amount" : "amountRaw"),
        event.blockNumber.toString(),
        observedAt,
      ],
    );
  if (event.eventName === "ProofClaimVerified")
    await sql.unsafe(
      `insert into ${schema}.launchpad_proof_receipts(chain_id,transaction_hash,log_index,snapshot_id,recipient_address,nullifier,amount_raw,verifier_version,block_number,observed_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict(chain_id,transaction_hash,log_index) do update set
       snapshot_id=excluded.snapshot_id,recipient_address=excluded.recipient_address,nullifier=excluded.nullifier,
       amount_raw=excluded.amount_raw,verifier_version=excluded.verifier_version,block_number=excluded.block_number,observed_at=excluded.observed_at`,
      [
        event.chainId,
        event.transactionHash.toLowerCase(),
        event.logIndex,
        value(event, "snapshotId"),
        value(event, "recipient"),
        value(event, "nullifier"),
        value(event, "amount"),
        value(event, "verifierVersion"),
        event.blockNumber.toString(),
        observedAt,
      ],
    );
  const binding = dbcLaunchBindingFromEvent(event);
  if (binding)
    await sql.unsafe(
      `update ${schema}.dbc_launches set launchpad_bound=true,launchpad_id=$3,fee_snapshot_id=$4,
      binding_schema_version=$5,launchpad_treasury=$6,launchpad_config_preset_id=$7,
      launchpad_config_hash=$8,graduation_destination=$9,updated_block=$10,updated_at=now()
      where chain_id=$1 and launch_id=$2`,
      [
        event.chainId,
        binding.launchId,
        binding.launchpadId.toString(),
        binding.feeSnapshotId,
        binding.bindingSchemaVersion,
        binding.treasury,
        binding.configPresetId.toString(),
        binding.configHash,
        binding.graduationDestination,
        event.blockNumber.toString(),
      ],
    );
  if (event.eventName === "GraduationAttemptStarted")
    await sql.unsafe(
      `insert into ${schema}.dbc_graduation_attempts(chain_id,migration_id,launch_id,source_pool,adapter,status,attempts,transaction_hash,updated_block)
     values($1,$2,$3,$4,$5,'GRADUATING',$6,$7,$8) on conflict(chain_id,migration_id) do update set status='GRADUATING',attempts=excluded.attempts,
     failure_hash=null,transaction_hash=excluded.transaction_hash,updated_block=excluded.updated_block,updated_at=now()`,
      [
        event.chainId,
        value(event, "migrationId"),
        launchId,
        value(event, "sourcePool"),
        value(event, "adapter"),
        value(event, "attempt"),
        event.transactionHash.toLowerCase(),
        event.blockNumber.toString(),
      ],
    );
  if (event.eventName === "GraduationAdapterBound")
    await sql.unsafe(
      `insert into ${schema}.dbc_graduation_adapter_bindings(chain_id,migration_id,adapter_address,factory_address,adapter_version,migration_mode,configuration_hash,transaction_hash,log_index,block_number,observed_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict(chain_id,migration_id) do update set
       adapter_address=excluded.adapter_address,factory_address=excluded.factory_address,adapter_version=excluded.adapter_version,
       migration_mode=excluded.migration_mode,configuration_hash=excluded.configuration_hash,transaction_hash=excluded.transaction_hash,
       log_index=excluded.log_index,block_number=excluded.block_number,observed_at=excluded.observed_at`,
      [
        event.chainId,
        value(event, "migrationId"),
        value(event, "adapter"),
        value(event, "factory"),
        value(event, "version"),
        value(event, "mode"),
        value(event, "configurationHash"),
        event.transactionHash.toLowerCase(),
        event.logIndex,
        event.blockNumber.toString(),
        observedAt,
      ],
    );
  if (
    event.eventName === "GraduationAttemptPending" ||
    event.eventName === "GraduationNeedsReview"
  )
    await sql.unsafe(
      `insert into ${schema}.dbc_graduation_attempts(chain_id,migration_id,launch_id,status,attempts,failure_hash,transaction_hash,updated_block)
     values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(chain_id,migration_id) do update set status=excluded.status,attempts=excluded.attempts,
     failure_hash=excluded.failure_hash,transaction_hash=excluded.transaction_hash,updated_block=excluded.updated_block,updated_at=now()`,
      [
        event.chainId,
        value(event, "migrationId"),
        launchId,
        event.eventName === "GraduationNeedsReview"
          ? "FAILED_NEEDS_REVIEW"
          : "PENDING_RETRY",
        value(
          event,
          event.eventName === "GraduationNeedsReview" ? "attempts" : "attempt",
        ),
        value(event, "failureHash"),
        event.transactionHash.toLowerCase(),
        event.blockNumber.toString(),
      ],
    );
  if (event.eventName === "GraduationReviewReopened")
    await sql.unsafe(
      `update ${schema}.dbc_graduation_attempts set status='PENDING_RETRY',attempts=0,failure_hash=null,
     transaction_hash=$3,updated_block=$4,updated_at=now() where chain_id=$1 and migration_id=$2`,
      [
        event.chainId,
        value(event, "migrationId"),
        event.transactionHash.toLowerCase(),
        event.blockNumber.toString(),
      ],
    );
  if (event.eventName === "GraduationContextBound")
    await sql.unsafe(
      `update ${schema}.dbc_graduation_attempts set launchpad_id=$3,config_hash=$4,fee_snapshot_id=$5,
     graduation_destination=$6,updated_block=$7,updated_at=now() where chain_id=$1 and migration_id=$2`,
      [
        event.chainId,
        value(event, "migrationId"),
        value(event, "launchpadId"),
        value(event, "configHash"),
        value(event, "feeSnapshotId"),
        value(event, "graduationDestination"),
        event.blockNumber.toString(),
      ],
    );
  if (event.eventName === "GraduationCompleted")
    await sql.unsafe(
      `insert into ${schema}.dbc_graduations(chain_id,migration_id,launch_id,destination_pool,base_migrated_raw,quote_migrated_raw,destination_shares_raw,transaction_hash,block_number,observed_at)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict(chain_id,migration_id) do update set destination_pool=excluded.destination_pool,
     destination_shares_raw=excluded.destination_shares_raw,transaction_hash=excluded.transaction_hash,block_number=excluded.block_number,observed_at=excluded.observed_at`,
      [
        event.chainId,
        value(event, "migrationId"),
        launchId,
        value(event, "destinationPool"),
        value(event, "baseMigrated"),
        value(event, "quoteMigrated"),
        value(event, "destinationShares"),
        event.transactionHash.toLowerCase(),
        event.blockNumber.toString(),
        observedAt,
      ],
    );
  if (event.eventName === "GraduationCompleted")
    await sql.unsafe(
      `update ${schema}.dbc_graduation_attempts set status='GRADUATED',failure_hash=null,transaction_hash=$2,
     updated_block=$3,updated_at=now() where chain_id=$4 and migration_id=$1`,
      [
        value(event, "migrationId"),
        event.transactionHash.toLowerCase(),
        event.blockNumber.toString(),
        event.chainId,
      ],
    );
  if (event.eventName === "AllocationRegistered") {
    const migrationId = value(event, "migrationId");
    const unlockAt = new Date(
      Number(BigInt(value(event, "creatorUnlockAt"))) * 1_000,
    );
    await sql.unsafe(
      `insert into ${schema}.dbc_lp_allocations(chain_id,migration_id,allocation_kind,recipient,shares_raw,unlock_at,updated_block)
       values($1,$2,'creator',$3,$4,$5,$6),($1,$2,'protocol',$7,$8,null,$6)
       on conflict(chain_id,migration_id,allocation_kind) do update set shares_raw=excluded.shares_raw,unlock_at=excluded.unlock_at,updated_block=excluded.updated_block`,
      [
        event.chainId,
        migrationId,
        value(event, "creator"),
        value(event, "creatorShares"),
        unlockAt,
        event.blockNumber.toString(),
        value(event, "protocolRecipient"),
        value(event, "protocolShares"),
      ],
    );
  }
  if (event.eventName === "AllocationClaimed")
    await sql.unsafe(
      `update ${schema}.dbc_lp_allocations set claimed=true,claim_transaction_hash=$4,updated_block=$5
     where chain_id=$1 and migration_id=$2 and allocation_kind=$3`,
      [
        event.chainId,
        value(event, "migrationId"),
        booleanValue(event, "creatorAllocation") ? "creator" : "protocol",
        event.transactionHash.toLowerCase(),
        event.blockNumber.toString(),
      ],
    );
  return true;
}

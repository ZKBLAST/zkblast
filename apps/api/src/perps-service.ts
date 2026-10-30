import postgres from "postgres";
import { encodeFunctionData, keccak256, type Address, type Hex } from "viem";
import { erc20Abi, liquidityVaultUsdGAbi, shieldedPerpAdapterAbi } from "@zkblast/abi";
import { perpsRelaySimulationErrorCode } from "./perps-relay-errors.js";

type PerpsExecutionConfig = Readonly<{
  chainId: number;
  vault: Address;
  collateral: Address;
  privateExecution?: Readonly<{ adapter: Address; relayer: Address; feeRaw: bigint }>;
}>;
type CloseQuote = Readonly<{
  executionPriceX18: bigint;
  closeFeeUsd: bigint;
  payoutUsd: bigint;
  realizedPnlUsd: bigint;
  fundingPaymentUsd: bigint;
  currentNotionalUsd: bigint;
}>;
type ModifyQuote = Readonly<{
  expectedLockedMarginUsd: bigint;
  notionalUsd: bigint;
  closePriceX18: bigint;
  openPriceX18: bigint;
  totalProtocolFeeUsd: bigint;
  realizedPnlUsd: bigint;
  fundingPaymentUsd: bigint;
}>;

export class PerpsService {
  readonly #sql: postgres.Sql;
  readonly #schema: string;
  readonly #execution: PerpsExecutionConfig | undefined;
  readonly #quoteClose: ((positionId: Hex) => Promise<CloseQuote>) | undefined;
  readonly #quoteModify: ((positionId: Hex, leverageBps: number, externalFeeRaw: bigint) => Promise<ModifyQuote>) | undefined;
  readonly #liquidatedResidual: ((positionId: Hex) => Promise<bigint>) | undefined;
  readonly #simulatePrivateRelay: ((input: Readonly<{ from: Address; to: Address; data: Hex }>) => Promise<void>) | undefined;
  readonly #latestOraclePrice: ((oracleId: Hex) => Promise<Readonly<{ value: bigint; updatedAt: bigint }>>) | undefined;

  constructor(
    databaseUrl: string,
    schema: string,
    execution?: PerpsExecutionConfig,
    quoteClose?: (positionId: Hex) => Promise<CloseQuote>,
    quoteModify?: (positionId: Hex, leverageBps: number, externalFeeRaw: bigint) => Promise<ModifyQuote>,
    liquidatedResidual?: (positionId: Hex) => Promise<bigint>,
    simulatePrivateRelay?: (input: Readonly<{ from: Address; to: Address; data: Hex }>) => Promise<void>,
    latestOraclePrice?: (oracleId: Hex) => Promise<Readonly<{ value: bigint; updatedAt: bigint }>>,
  ) {
    if (!/^zkblast_(testnet|mainnet)$/u.test(schema)) throw new Error("Invalid schema");
    this.#sql = postgres(databaseUrl, { max: 3 });
    this.#schema = schema;
    this.#execution = execution;
    this.#quoteClose = quoteClose;
    this.#quoteModify = quoteModify;
    this.#liquidatedResidual = liquidatedResidual;
    this.#simulatePrivateRelay = simulatePrivateRelay;
    this.#latestOraclePrice = latestOraclePrice;
  }

  async markets() {
    return this.#sql<Array<Record<string, unknown>>>`
      select market_id as "marketId",symbol,base_asset as "baseAsset",oracle_id as "oracleId",
        max_open_interest_raw::text as "maxOpenInterestRaw",
        max_skew_raw::text as "maxSkewRaw",max_position_raw::text as "maxPositionRaw",
        min_position_raw::text as "minPositionRaw",max_leverage_bps as "maxLeverageBps",
        maintenance_margin_bps as "maintenanceMarginBps",position_fee_bps as "positionFeeBps",
        liquidation_fee_bps as "liquidationFeeBps",max_price_impact_bps as "maxPriceImpactBps",
        enabled,paused,long_open_interest_raw::text as "longOpenInterestRaw",
        short_open_interest_raw::text as "shortOpenInterestRaw",
        funding_rate_bps_per_hour as "fundingRateBpsPerHour",
        funding_index_x18::text as "fundingIndexX18",funding_updated_at as "fundingUpdatedAt",
        updated_block::text as "updatedBlock",updated_at as "updatedAt",
        p.price_x18::text as "currentPriceX18",p.oracle_updated_at as "oracleUpdatedAt"
      from ${this.#sql(this.#schema)}.perp_markets m
      left join lateral (
        select price_x18,oracle_updated_at from ${this.#sql(this.#schema)}.perp_oracle_prices
        where market_id=m.market_id and canonical order by block_number desc limit 1
      ) p on true
      order by enabled desc,symbol asc
    `;
  }

  async oracleHistory(
    marketId: string,
    input: Readonly<{ from: Date; to: Date; limit: number }>,
  ) {
    return this.#sql<Array<Record<string, unknown>>>`
      select 'oracle' as source,oracle_updated_at as "observedAt",
        (price_x18::numeric / 1000000000000000000)::text as price,
        null::text as volume,block_number::text as "blockNumber",
        null::text as "transactionHash",'USD' as "priceUnit"
      from ${this.#sql(this.#schema)}.perp_oracle_prices
      where market_id=${marketId} and canonical
        and oracle_updated_at >= ${input.from} and oracle_updated_at <= ${input.to}
      order by oracle_updated_at asc,block_number asc limit ${input.limit}
    `;
  }

  async currentOraclePrice(marketId: Hex) {
    if (!this.#latestOraclePrice) throw new Error("PERPS_ORACLE_UNAVAILABLE");
    const rows = await this.#sql<Array<{ oracleId: Hex }>>`
      select oracle_id as "oracleId" from ${this.#sql(this.#schema)}.perp_markets
      where market_id=${marketId.toLowerCase()} limit 1
    `;
    const market = rows[0];
    if (!market) throw new Error("PERP_MARKET_UNAVAILABLE");
    const price = await this.#latestOraclePrice(market.oracleId);
    return { marketId, priceX18: price.value.toString(), updatedAt: price.updatedAt.toString(), source: "onchain_oracle" };
  }

  async marketCatalog() {
    return this.#sql<Array<Record<string, unknown>>>`
      select c.pool_address as "poolAddress",c.pool_model as "poolModel",
        c.base_address as "baseAddress",c.base_symbol as "baseSymbol",
        c.quote_address as "quoteAddress",c.quote_symbol as "quoteSymbol",
        c.pool_status as "poolStatus",c.registered_market_id as "marketId",
        coalesce(m.enabled,false) as "enabled",coalesce(m.paused,true) as "paused",
        case
          when c.pool_status <> 'active' then 'pool_unavailable'
          when c.registered_market_id is null then 'oracle_required'
          when not m.enabled or m.paused then 'market_paused'
          else 'executable' end as "executionStatus"
      from ${this.#sql(this.#schema)}.perp_market_catalog c
      left join ${this.#sql(this.#schema)}.perp_markets m on m.market_id=c.registered_market_id
      where c.pool_status='active'
      order by (case when m.enabled and not m.paused then 0 else 1 end),c.pool_model desc,c.base_symbol,c.quote_symbol
    `;
  }

  async positions(ownerCommitment?: string, ownerAddress?: string) {
    return this.#sql<Array<Record<string, unknown>>>`
      select position_id as "positionId",market_id as "marketId",
        owner_commitment as "ownerCommitment",public_owner_address as "publicOwnerAddress",
        is_long as "isLong",margin_raw::text as "marginRaw",
        notional_raw::text as "notionalRaw",base_size_raw::text as "baseSizeRaw",
        entry_price_x18::text as "entryPriceX18",funding_index_x18::text as "fundingIndexX18",
        status,opened_transaction_hash as "openedTransactionHash",
        closed_transaction_hash as "closedTransactionHash",opened_block::text as "openedBlock",
        closed_block::text as "closedBlock",opened_at as "openedAt",closed_at as "closedAt"
      from ${this.#sql(this.#schema)}.perp_positions
      where (${ownerCommitment ?? null}::text is null or owner_commitment=${ownerCommitment ?? null})
        and (${ownerAddress?.toLowerCase() ?? null}::text is null or public_owner_address=${ownerAddress?.toLowerCase() ?? null})
      order by opened_block desc limit 100
    `;
  }

  async vault() {
    const rows = await this.#sql<Array<Record<string, unknown>>>`
      select block_number::text as "blockNumber",total_assets_raw::text as "totalAssetsRaw",
        lp_assets_raw::text as "lpAssetsRaw",available_liquidity_raw::text as "availableLiquidityRaw",
        trader_margin_liability_raw::text as "traderMarginLiabilityRaw",
        reserved_profit_liquidity_raw::text as "reservedProfitLiquidityRaw",
        total_shares_raw::text as "totalSharesRaw",insurance_assets_raw::text as "insuranceAssetsRaw",
        observed_at as "observedAt"
      from ${this.#sql(this.#schema)}.perp_vault_snapshots order by block_number desc limit 1
    `;
    return rows[0] ?? null;
  }

  async closeQuote(positionId: Hex) {
    if (!this.#quoteClose) throw new Error("PERPS_NOT_DEPLOYED");
    const quote = await this.#quoteClose(positionId);
    return Object.fromEntries(Object.entries(quote).map(([key, value]) => [key, value.toString()]));
  }

  async modifyQuote(positionId: Hex, leverageBps: number) {
    const execution = this.#requireExecution();
    if (!this.#quoteModify || !execution.privateExecution) throw new Error("PERPS_NOT_DEPLOYED");
    if (!Number.isInteger(leverageBps) || leverageBps < 10_000 || leverageBps > 100_000) {
      throw new Error("PERP_RISK_LIMIT");
    }
    const quote = await this.#quoteModify(positionId, leverageBps, execution.privateExecution.feeRaw);
    return Object.fromEntries(Object.entries(quote).map(([key, value]) => [key, value.toString()]));
  }

  async residual(positionId: Hex) {
    if (!this.#liquidatedResidual) throw new Error("PERPS_NOT_DEPLOYED");
    return { residualRaw: (await this.#liquidatedResidual(positionId)).toString() };
  }

  async activity(input: Readonly<{
    ownerAddress?: string;
    limit: number;
    cursorBlock?: bigint;
    cursorLogIndex?: number;
  }>) {
    const owner = input.ownerAddress?.toLowerCase() ?? null;
    const rows = await this.#sql<Array<Record<string, unknown> & { blockNumber: string; logIndex: number }>>`
      select e.transaction_hash as "transactionHash",e.log_index as "logIndex",
        e.block_number::text as "blockNumber",e.block_timestamp as "blockTimestamp",
        e.event_kind as "eventKind",e.market_id as "marketId",e.position_id as "positionId",e.payload
      from ${this.#sql(this.#schema)}.perp_events e
      left join ${this.#sql(this.#schema)}.perp_positions p on p.position_id=e.position_id
      where e.canonical
        and (${owner}::text is null or p.public_owner_address=${owner}
          or lower(e.payload->>'owner')=${owner} or lower(e.payload->>'sender')=${owner}
          or lower(e.payload->>'recipient')=${owner})
        and (${input.cursorBlock?.toString() ?? null}::bigint is null
          or (e.block_number,e.log_index) < (${input.cursorBlock?.toString() ?? null}::bigint,${input.cursorLogIndex ?? null}::integer))
      order by e.block_number desc,e.log_index desc limit ${input.limit + 1}
    `;
    const hasMore = rows.length > input.limit;
    const items = hasMore ? rows.slice(0, input.limit) : rows;
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? `${last.blockNumber}:${last.logIndex}` : null,
    };
  }

  async prepareOpen(input: Readonly<{
    positionId: Hex;
    ownerCommitment: Hex;
    marketId: Hex;
    marginRaw: bigint;
    leverageBps: number;
    acceptablePriceX18: bigint;
    deadline: bigint;
    isLong: boolean;
  }>) {
    const execution = this.#requireExecution();
    this.#validateDeadline(input.deadline);
    const rows = await this.#sql<Array<{ enabled: boolean; paused: boolean; maxLeverageBps: number; minPositionRaw: string; maxPositionRaw: string }>>`
      select enabled,paused,max_leverage_bps as "maxLeverageBps",
        min_position_raw::text as "minPositionRaw",max_position_raw::text as "maxPositionRaw"
      from ${this.#sql(this.#schema)}.perp_markets where market_id=${input.marketId.toLowerCase()} limit 1
    `;
    const market = rows[0];
    if (!market || !market.enabled || market.paused) throw new Error("PERP_MARKET_UNAVAILABLE");
    const notional = (input.marginRaw * BigInt(input.leverageBps)) / 10_000n;
    if (
      input.leverageBps > market.maxLeverageBps ||
      notional < BigInt(market.minPositionRaw) ||
      notional > BigInt(market.maxPositionRaw)
    ) throw new Error("PERP_RISK_LIMIT");
    return {
      chainId: execution.chainId,
      transactions: [
        {
          to: execution.collateral,
          data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [execution.vault, input.marginRaw] }),
          value: "0x0",
        },
        {
          to: execution.vault,
          data: encodeFunctionData({
            abi: liquidityVaultUsdGAbi,
            functionName: "openPublicPosition",
            args: [{
              positionId: input.positionId,
              ownerCommitment: input.ownerCommitment,
              marketId: input.marketId,
              marginUsd: input.marginRaw,
              leverageBps: input.leverageBps,
              acceptablePriceX18: input.acceptablePriceX18,
              deadline: input.deadline,
              isLong: input.isLong,
            }],
          }),
          value: "0x0",
        },
      ],
    };
  }

  prepareClose(input: Readonly<{
    positionId: Hex;
    payoutCommitment: Hex;
    acceptablePriceX18: bigint;
    deadline: bigint;
    recipient: Address;
  }>) {
    const execution = this.#requireExecution();
    this.#validateDeadline(input.deadline);
    return {
      chainId: execution.chainId,
      transactions: [{
        to: execution.vault,
        data: encodeFunctionData({
          abi: liquidityVaultUsdGAbi,
          functionName: "closePublicPosition",
          args: [input.positionId, input.payoutCommitment, input.acceptablePriceX18, input.deadline, input.recipient],
        }),
        value: "0x0",
      }],
    };
  }

  async enqueuePrivateRelay(input: Readonly<{
    action: "open" | "close" | "modify" | "claim-liquidated";
    proof: Hex;
    publicInputs: readonly bigint[];
  }>) {
    const execution = this.#requireExecution();
    const privateExecution = execution.privateExecution;
    if (!privateExecution) throw new Error("PERPS_RELAYER_UNAVAILABLE");
    const specification = {
      open: { count: 21, deadline: 14, relayer: 18, fee: 19, functionName: "openPrivatePosition" },
      close: { count: 17, deadline: 13, relayer: 15, fee: 16, functionName: "closePrivatePosition" },
      modify: { count: 19, deadline: 16, relayer: 17, fee: 18, functionName: "modifyPrivatePosition" },
      "claim-liquidated": { count: 16, deadline: 12, relayer: 14, fee: 15, functionName: "claimLiquidatedResidual" },
    } as const;
    const action = specification[input.action];
    if (input.publicInputs.length !== action.count || !/^0x[0-9a-f]{512}$/iu.test(input.proof)) {
      throw new Error("PERPS_RELAY_REQUEST_INVALID");
    }
    const deadline = input.publicInputs[action.deadline]!;
    this.#validateDeadline(deadline);
    if (
      input.publicInputs[action.relayer] !== BigInt(privateExecution.relayer)
        || input.publicInputs[action.fee] !== privateExecution.feeRaw
    ) throw new Error("PERPS_RELAYER_TERMS_MISMATCH");
    // The selected ABI overload is runtime-bound after the exact public-input length check above.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    const calldata = encodeFunctionData({
      abi: shieldedPerpAdapterAbi,
      functionName: action.functionName,
      args: [input.proof, input.publicInputs],
    } as never);
    const requestId = keccak256(calldata);
    if (this.#simulatePrivateRelay) {
      try {
        await this.#simulatePrivateRelay({
          from: privateExecution.relayer,
          to: privateExecution.adapter,
          data: calldata,
        });
      } catch (error) {
        throw new Error(perpsRelaySimulationErrorCode(error));
      }
    }
    await this.#sql`
      insert into ${this.#sql(this.#schema)}.perp_relayer_jobs
        (request_id,action,adapter,calldata,deadline)
      values (
        ${requestId.toLowerCase()},${input.action},${privateExecution.adapter.toLowerCase()},
        ${calldata.toLowerCase()},to_timestamp(${deadline.toString()})
      ) on conflict (request_id) do nothing
    `;
    return this.privateRelayStatus(requestId);
  }

  async privateRelayStatus(requestId: Hex) {
    const rows = await this.#sql<Array<Record<string, unknown>>>`
      select request_id as "requestId",action,status,transaction_hash as "transactionHash",
        error_code as "errorCode",deadline,attempts,created_at as "createdAt",updated_at as "updatedAt"
      from ${this.#sql(this.#schema)}.perp_relayer_jobs where request_id=${requestId.toLowerCase()} limit 1
    `;
    if (!rows[0]) throw new Error("PERPS_RELAY_REQUEST_NOT_FOUND");
    return rows[0];
  }

  #requireExecution(): PerpsExecutionConfig {
    if (!this.#execution) throw new Error("PERPS_NOT_DEPLOYED");
    return this.#execution;
  }

  #validateDeadline(deadline: bigint) {
    const now = BigInt(Math.floor(Date.now() / 1_000));
    if (deadline <= now || deadline > now + 3_600n) {
      throw new Error("PERP_INVALID_DEADLINE");
    }
  }
}

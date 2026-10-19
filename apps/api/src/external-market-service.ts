import postgres from "postgres";
import { z } from "zod";

const rowSchema = z.object({
  id: z.string().uuid(),
  source: z.enum(["pons_graduated", "robinhood_stock_token"]),
  externalId: z.string(),
  chainId: z.coerce.number().int().positive(),
  executionChainId: z.coerce.number().int().positive().nullable(),
  contractAddress: z.string().regex(/^0x[0-9a-f]{40}$/u),
  symbol: z.string(),
  name: z.string(),
  quoteSymbol: z.string(),
  status: z.enum(["active", "halted", "inactive"]),
  readOnly: z.boolean(),
  marketRegion: z.enum(["unclassified", "crypto", "us", "china"]),
  marketCapUsd: z.string().nullable(),
  marketCapObservedAt: z.coerce.date().nullable(),
  logoUrl: z.string().url().nullable(),
  logoStatus: z.enum(["pending", "approved", "rejected", "missing"]),
  oracleProvider: z.string().nullable(),
  pairCandidates: z.array(
    z.object({
      quoteSymbol: z.enum(["USDG", "WETH"]),
      logoUrl: z.string().url().nullable(),
      quoteAddress: z.string().regex(/^0x[0-9a-f]{40}$/u),
      executionChainId: z.coerce.number().int().positive(),
      baseAddress: z
        .string()
        .regex(/^0x[0-9a-f]{40}$/u)
        .nullable(),
      priority: z.coerce.number().int().min(1).max(10),
      routeStatus: z.enum(["planned", "observed", "validated", "disabled"]),
      venue: z.string().nullable(),
      poolIdentifier: z.string().nullable(),
      liquidityRaw: z.string().nullable(),
    }),
  ),
  metadata: z.record(z.unknown()),
  validatedAt: z.coerce.date(),
  bid: z.string().nullable(),
  ask: z.string().nullable(),
  currency: z.string().nullable(),
  dailyVolume: z.string().nullable(),
  quoteObservedAt: z.coerce.date().nullable(),
});

const pricePointSchema = z.object({
  source: z.enum(["swap", "oracle", "reference"]),
  observedAt: z.coerce.date(),
  price: z.string(),
  volume: z.string().nullable(),
  blockNumber: z.string().nullable(),
  transactionHash: z.string().nullable(),
});

export type ExternalMarketSource = "pons_graduated" | "robinhood_stock_token";

export class ExternalMarketService {
  readonly #sql: postgres.Sql;

  constructor(
    databaseUrl: string,
    readonly schema: string,
  ) {
    if (!/^zkblast_(testnet|mainnet)$/u.test(schema))
      throw new Error("Invalid schema");
    this.#sql = postgres(databaseUrl, { max: 3, prepare: true });
  }

  async list(
    input: Readonly<{
      source?: ExternalMarketSource | undefined;
      region?: "unclassified" | "crypto" | "us" | "china" | undefined;
      minMarketCapUsd?: number | undefined;
      limit: number;
      cursor?: string | undefined;
    }>,
  ) {
    const rows = await this.#sql.unsafe(
      `select m.id,m.source,m.external_id as "externalId",m.chain_id as "chainId",m.execution_chain_id as "executionChainId",m.contract_address as "contractAddress",m.symbol,m.name,m.quote_symbol as "quoteSymbol",m.status,m.read_only as "readOnly",m.market_region as "marketRegion",m.market_cap_usd::text as "marketCapUsd",m.market_cap_observed_at as "marketCapObservedAt",case when m.logo_status='approved' then m.logo_url end as "logoUrl",m.logo_status as "logoStatus",m.oracle_provider as "oracleProvider",m.metadata,m.validated_at as "validatedAt",q.bid::text,q.ask::text,q.currency,q.daily_volume::text as "dailyVolume",q.observed_at as "quoteObservedAt",
       coalesce((select jsonb_agg(jsonb_build_object('quoteSymbol',p.quote_symbol,'logoUrl',m.metadata->'quoteLogos'->>p.quote_symbol,'quoteAddress',p.quote_address,'executionChainId',p.execution_chain_id,'baseAddress',p.base_address,'priority',p.priority,'routeStatus',p.route_status,'venue',p.venue,'poolIdentifier',p.pool_identifier,'liquidityRaw',p.liquidity_raw::text) order by p.priority) from ${this.schema}.external_market_pairs p where p.market_id=m.id),'[]'::jsonb) as "pairCandidates"
       from ${this.schema}.external_markets m
       left join lateral (select bid,ask,currency,daily_volume,observed_at from ${this.schema}.external_market_quotes where market_id=m.id order by observed_at desc limit 1) q on true
       where ($1::text is null or m.source=$1)
         and ($2::text is null or m.market_region=$2)
         and ($3::numeric is null or m.market_cap_usd >= $3)
         and ($4::text is null or m.id::text > $4)
       order by m.id asc limit $5`,
      [
        input.source ?? null,
        input.region ?? null,
        input.minMarketCapUsd ?? null,
        input.cursor ?? null,
        input.limit,
      ],
    );
    return rows.map((row) => {
      const parsed = rowSchema.parse(row);
      return {
        ...parsed,
        validatedAt: parsed.validatedAt.toISOString(),
        marketCapObservedAt: parsed.marketCapObservedAt?.toISOString() ?? null,
        quoteObservedAt: parsed.quoteObservedAt?.toISOString() ?? null,
        canTrade: parsed.pairCandidates.some(
          (pair) => pair.routeStatus === "validated",
        ),
        provenance:
          parsed.source === "pons_graduated"
            ? "pons contracts on Robinhood Chain"
            : "Robinhood Stock Token read-only API",
      };
    });
  }

  async priceHistory(
    marketId: string,
    input: Readonly<{
      source: "swap" | "oracle" | "reference";
      from: Date;
      to: Date;
      limit: number;
    }>,
  ) {
    const rows = await this.#sql.unsafe(
      `select source,observed_at as "observedAt",price::text,volume::text,
        block_number::text as "blockNumber",transaction_hash as "transactionHash"
       from ${this.schema}.external_market_price_points
       where market_id=$1 and source=$2 and observed_at >= $3 and observed_at <= $4
       order by observed_at asc limit $5`,
      [marketId, input.source, input.from, input.to, input.limit],
    );
    return rows.map((row) => {
      const parsed = pricePointSchema.parse(row);
      return { ...parsed, observedAt: parsed.observedAt.toISOString() };
    });
  }

  async validatedRoute(marketId: string, quoteSymbol: "USDG" | "WETH") {
    const rows = await this.#sql.unsafe(
      `select m.symbol,p.execution_chain_id as "chainId",p.base_address as "baseAddress",
        p.quote_address as "quoteAddress",p.pool_identifier as "poolAddress",
        p.venue,coalesce((m.metadata->>'executionDecimals')::integer,18) as "baseDecimals"
       from ${this.schema}.external_market_pairs p
       join ${this.schema}.external_markets m on m.id=p.market_id
       where m.id=$1 and p.quote_symbol=$2 and p.route_status='validated'
         and p.base_address is not null and p.pool_identifier is not null
         and p.observed_at > now() - interval '1 day'
       limit 1`,
      [marketId, quoteSymbol],
    );
    return z
      .object({
        symbol: z.string(),
        chainId: z.coerce.number().int().positive(),
        baseAddress: z.string().regex(/^0x[0-9a-f]{40}$/u),
        quoteAddress: z.string().regex(/^0x[0-9a-f]{40}$/u),
        poolAddress: z.string().regex(/^0x[0-9a-f]{40}$/u),
        venue: z.enum(["zkblast_damm", "zkblast_dlmm"]),
        baseDecimals: z.coerce.number().int().min(0).max(36),
      })
      .parse(rows[0]);
  }

  async operationsSnapshot(maxRouteAgeSeconds: number) {
    const rows = await this.#sql.unsafe(
      `select
         count(*) filter (where route_status='validated')::integer as "validatedRoutes",
         count(*) filter (
           where route_status='validated'
             and (observed_at is null or observed_at <= now() - ($1 * interval '1 second'))
         )::integer as "staleValidatedRoutes",
         max(observed_at) filter (where route_status='validated') as "latestRouteObservedAt"
       from ${this.schema}.external_market_pairs`,
      [maxRouteAgeSeconds],
    );
    const snapshot = z
      .object({
        validatedRoutes: z.coerce.number().int().nonnegative(),
        staleValidatedRoutes: z.coerce.number().int().nonnegative(),
        latestRouteObservedAt: z.coerce.date().nullable(),
      })
      .parse(rows[0]);
    return {
      ...snapshot,
      latestRouteObservedAt:
        snapshot.latestRouteObservedAt?.toISOString() ?? null,
    };
  }
}

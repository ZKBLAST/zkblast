import postgres from "postgres";
import { getAddress, parseAbi, type Address, type PublicClient } from "viem";

const oracleAbi = parseAbi([
  "function latestPrice(bytes32 oracleId) view returns ((uint256 value,uint64 updatedAt) price)",
]);
const engineAbi = parseAbi([
  "function marketRisk(bytes32 marketId) view returns ((uint128 longOpenInterestUsd,uint128 shortOpenInterestUsd) risk)",
]);
const fundingAbi = parseAbi([
  "function fundingState(bytes32 marketId) view returns ((int128 cumulativeIndexX18,int32 rateBpsPerHour,uint32 maximumAbsoluteRateBpsPerHour,uint64 updatedAt) state)",
]);
const vaultAbi = parseAbi([
  "function totalAssets() view returns (uint256)",
  "function lpAssets() view returns (uint256)",
  "function availableLiquidity() view returns (uint256)",
  "function traderMarginLiability() view returns (uint256)",
  "function reservedProfitLiquidity() view returns (uint256)",
  "function totalShares() view returns (uint256)",
]);
const insuranceAbi = parseAbi(["function assets() view returns (uint256)"]);
const registryAbi = parseAbi([
  "function marketIds() view returns (bytes32[])",
  "function market(bytes32 marketId) view returns ((address baseAsset,bytes32 oracleId,uint128 maxOpenInterestUsd,uint128 maxSkewUsd,uint128 maxPositionUsd,uint128 minPositionUsd,uint32 maxLeverageBps,uint16 maintenanceMarginBps,uint16 positionFeeBps,uint16 liquidationFeeBps,uint16 maxPriceImpactBps,bool enabled) config)",
  "function isPaused(bytes32 marketId) view returns (bool)",
]);

export type PerpsStateAddresses = Readonly<{
  registry: Address;
  oracle: Address;
  engine: Address;
  funding: Address;
  vault: Address;
  insurance: Address;
}>;

export class PerpsStateSynchronizer {
  readonly #sql: postgres.Sql;

  constructor(
    databaseUrl: string,
    readonly schema: string,
    readonly client: PublicClient,
    readonly addresses?: PerpsStateAddresses,
  ) {
    if (!/^zkblast_(testnet|mainnet)$/u.test(schema))
      throw new Error("INVALID_DATABASE_SCHEMA");
    this.#sql = postgres(databaseUrl, {
      max: 1,
      prepare: false,
      idle_timeout: 10,
    });
  }

  async synchronize() {
    await this.#synchronizeCatalog();
    if (!this.addresses) return { blockNumber: null, markets: 0 };
    const addresses = this.addresses;
    const blockNumber = await this.client.getBlockNumber();
    const block = await this.client.getBlock({ blockNumber });
    if (!block.hash) throw new Error("PERPS_SNAPSHOT_BLOCK_UNAVAILABLE");
    await this.#reconcileMarkets(addresses.registry, blockNumber);
    const markets = await this.#sql.unsafe<
      { market_id: `0x${string}`; oracle_id: `0x${string}` }[]
    >(
      `select market_id,oracle_id from ${this.schema}.perp_markets where enabled`,
    );
    for (const market of markets) {
      const [price, risk, funding] = await Promise.all([
        this.client.readContract({
          address: addresses.oracle,
          abi: oracleAbi,
          functionName: "latestPrice",
          args: [market.oracle_id],
          blockNumber,
        }),
        this.client.readContract({
          address: addresses.engine,
          abi: engineAbi,
          functionName: "marketRisk",
          args: [market.market_id],
          blockNumber,
        }),
        this.client.readContract({
          address: addresses.funding,
          abi: fundingAbi,
          functionName: "fundingState",
          args: [market.market_id],
          blockNumber,
        }),
      ]);
      await this.#sql.begin(async (transaction) => {
        await transaction.unsafe(
          `insert into ${this.schema}.perp_oracle_prices
            (market_id,block_number,block_hash,price_x18,oracle_updated_at,canonical)
           values ($1,$2,$3,$4,to_timestamp($5),true)
           on conflict (market_id,block_number) do update set
            block_hash=excluded.block_hash,price_x18=excluded.price_x18,
            oracle_updated_at=excluded.oracle_updated_at,canonical=true`,
          [
            market.market_id,
            blockNumber.toString(),
            block.hash.toLowerCase(),
            price.value.toString(),
            price.updatedAt.toString(),
          ],
        );
        await transaction.unsafe(
          `update ${this.schema}.perp_markets set
            long_open_interest_raw=$2,short_open_interest_raw=$3,
            funding_rate_bps_per_hour=$4,funding_index_x18=$5,
            funding_updated_at=to_timestamp($6),updated_at=now()
           where market_id=$1`,
          [
            market.market_id,
            risk.longOpenInterestUsd.toString(),
            risk.shortOpenInterestUsd.toString(),
            funding.rateBpsPerHour,
            funding.cumulativeIndexX18.toString(),
            funding.updatedAt.toString(),
          ],
        );
      });
    }

    const vaultRead = (
      functionName:
        | "totalAssets"
        | "lpAssets"
        | "availableLiquidity"
        | "traderMarginLiability"
        | "reservedProfitLiquidity"
        | "totalShares",
    ) =>
      this.client.readContract({
        address: addresses.vault,
        abi: vaultAbi,
        functionName,
        blockNumber,
      });
    const [
      totalAssets,
      lpAssets,
      availableLiquidity,
      marginLiability,
      reservedProfit,
      totalShares,
      insuranceAssets,
    ] = await Promise.all([
      vaultRead("totalAssets"),
      vaultRead("lpAssets"),
      vaultRead("availableLiquidity"),
      vaultRead("traderMarginLiability"),
      vaultRead("reservedProfitLiquidity"),
      vaultRead("totalShares"),
      this.client.readContract({
        address: addresses.insurance,
        abi: insuranceAbi,
        functionName: "assets",
        blockNumber,
      }),
    ]);
    await this.#sql.unsafe(
      `insert into ${this.schema}.perp_vault_snapshots
        (block_number,block_hash,total_assets_raw,lp_assets_raw,available_liquidity_raw,
         trader_margin_liability_raw,reserved_profit_liquidity_raw,total_shares_raw,
         insurance_assets_raw,observed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,to_timestamp($10))
       on conflict (block_number) do update set
        block_hash=excluded.block_hash,total_assets_raw=excluded.total_assets_raw,
        lp_assets_raw=excluded.lp_assets_raw,available_liquidity_raw=excluded.available_liquidity_raw,
        trader_margin_liability_raw=excluded.trader_margin_liability_raw,
        reserved_profit_liquidity_raw=excluded.reserved_profit_liquidity_raw,
        total_shares_raw=excluded.total_shares_raw,insurance_assets_raw=excluded.insurance_assets_raw,
        observed_at=excluded.observed_at`,
      [
        blockNumber.toString(),
        block.hash.toLowerCase(),
        totalAssets.toString(),
        lpAssets.toString(),
        availableLiquidity.toString(),
        marginLiability.toString(),
        reservedProfit.toString(),
        totalShares.toString(),
        insuranceAssets.toString(),
        block.timestamp.toString(),
      ],
    );
    return { blockNumber, markets: markets.length };
  }

  close() {
    return this.#sql.end();
  }

  async #synchronizeCatalog() {
    await this.#sql.unsafe(
      `insert into ${this.schema}.perp_market_catalog
        (pool_address,pool_model,base_address,base_symbol,quote_address,quote_symbol,pool_status,registered_market_id)
       select p.address,p.pool_kind,
        case
          when x.symbol='USDG' then y.address when y.symbol='USDG' then x.address
          when x.symbol in ('WETH','ETH') then y.address else x.address end,
        case
          when x.symbol='USDG' then y.symbol when y.symbol='USDG' then x.symbol
          when x.symbol in ('WETH','ETH') then y.symbol else x.symbol end,
        case
          when x.symbol='USDG' then x.address when y.symbol='USDG' then y.address
          when x.symbol in ('WETH','ETH') then x.address else y.address end,
        case
          when x.symbol='USDG' then x.symbol when y.symbol='USDG' then y.symbol
          when x.symbol in ('WETH','ETH') then x.symbol else y.symbol end,
        p.status,
        (select m.market_id from ${this.schema}.perp_markets m
         where m.base_asset=case
          when x.symbol='USDG' then y.address when y.symbol='USDG' then x.address
          when x.symbol in ('WETH','ETH') then y.address else x.address end
         order by m.enabled desc,m.updated_block desc limit 1)
       from ${this.schema}.pools p
       join ${this.schema}.assets x on x.id=p.token_x_id
       join ${this.schema}.assets y on y.id=p.token_y_id
       on conflict (pool_address) do update set
        pool_model=excluded.pool_model,base_address=excluded.base_address,
        base_symbol=excluded.base_symbol,quote_address=excluded.quote_address,
        quote_symbol=excluded.quote_symbol,pool_status=excluded.pool_status,
        registered_market_id=excluded.registered_market_id,updated_at=now()`,
    );
  }

  async #reconcileMarkets(registry: Address, blockNumber: bigint) {
    const marketIds = await this.client.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "marketIds",
      blockNumber,
    });
    for (const marketId of marketIds) {
      const [config, paused] = await Promise.all([
        this.client.readContract({
          address: registry,
          abi: registryAbi,
          functionName: "market",
          args: [marketId],
          blockNumber,
        }),
        this.client.readContract({
          address: registry,
          abi: registryAbi,
          functionName: "isPaused",
          args: [marketId],
          blockNumber,
        }),
      ]);
      const baseAsset = config.baseAsset.toLowerCase();
      const [asset] = await this.#sql.unsafe<{ symbol: string }[]>(
        `select symbol from ${this.schema}.assets where address=$1 limit 1`,
        [baseAsset],
      );
      const symbol = `${asset?.symbol ?? "UNKNOWN"}-PERP`;
      await this.#sql.unsafe(
        `insert into ${this.schema}.perp_markets
          (market_id,symbol,base_asset,oracle_id,max_open_interest_raw,max_skew_raw,
           max_position_raw,min_position_raw,max_leverage_bps,maintenance_margin_bps,
           position_fee_bps,liquidation_fee_bps,max_price_impact_bps,enabled,paused,updated_block)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         on conflict (market_id) do update set
          symbol=excluded.symbol,base_asset=excluded.base_asset,oracle_id=excluded.oracle_id,
          max_open_interest_raw=excluded.max_open_interest_raw,max_skew_raw=excluded.max_skew_raw,
          max_position_raw=excluded.max_position_raw,min_position_raw=excluded.min_position_raw,
          max_leverage_bps=excluded.max_leverage_bps,
          maintenance_margin_bps=excluded.maintenance_margin_bps,
          position_fee_bps=excluded.position_fee_bps,
          liquidation_fee_bps=excluded.liquidation_fee_bps,
          max_price_impact_bps=excluded.max_price_impact_bps,enabled=excluded.enabled,
          paused=excluded.paused,updated_block=excluded.updated_block,updated_at=now()`,
        [
          marketId.toLowerCase(),
          symbol,
          baseAsset,
          config.oracleId.toLowerCase(),
          config.maxOpenInterestUsd.toString(),
          config.maxSkewUsd.toString(),
          config.maxPositionUsd.toString(),
          config.minPositionUsd.toString(),
          config.maxLeverageBps,
          config.maintenanceMarginBps,
          config.positionFeeBps,
          config.liquidationFeeBps,
          config.maxPriceImpactBps,
          config.enabled,
          paused,
          blockNumber.toString(),
        ],
      );
    }
  }
}

export function deploymentAddress(
  contracts: Readonly<
    Record<
      string,
      Readonly<{
        contractName: string;
        proxyAddress: string | null;
        implementationAddress: string;
      }>
    >
  >,
  contractName: string,
): Address | undefined {
  const deployment = Object.values(contracts).find(
    (item) => item.contractName === contractName,
  );
  return deployment
    ? getAddress(deployment.proxyAddress ?? deployment.implementationAddress)
    : undefined;
}

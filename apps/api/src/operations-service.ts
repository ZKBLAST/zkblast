import { dammPoolAbi } from "@zkblast/abi";
import type { ContractReader } from "@zkblast/sdk";
import type { Address } from "viem";
import type { LiquidityService } from "./liquidity-service.js";
import type { ProtocolService } from "./protocol-service.js";
import type { TradeReceiptMetrics } from "./trade-receipt-service.js";

export type OperationsThresholds = Readonly<{
  rpcLagBlocks: bigint;
  checkpointAgeSeconds: number;
  recentTransactionFailures: number;
  externalRouteAgeSeconds: number;
  receiptFailures: number;
}>;

type ExternalMarketMonitor = Readonly<{
  operationsSnapshot(maxRouteAgeSeconds: number): Promise<{
    validatedRoutes: number;
    staleValidatedRoutes: number;
    latestRouteObservedAt: string | null;
  }>;
}>;

type ReceiptMonitor = Readonly<{
  metrics(windowSeconds?: number): TradeReceiptMetrics;
}>;

type Alert = Readonly<{
  code: string;
  severity: "warning" | "critical";
  active: boolean;
  observed: string | number | boolean;
  threshold: string | number | boolean;
}>;

export class OperationsService {
  constructor(
    private readonly protocol: ProtocolService,
    private readonly liquidity: LiquidityService,
    private readonly chain: ContractReader,
    private readonly pool: Address,
    private readonly thresholds: OperationsThresholds,
    private readonly now: () => Date = () => new Date(),
    private readonly externalMarkets?: ExternalMarketMonitor,
    private readonly receipts?: ReceiptMonitor,
  ) {}

  async health() {
    const [readiness, accounting, paused, failures, externalMarkets] =
      await Promise.all([
        this.protocol.readiness(),
        this.liquidity.accounting(this.pool),
        this.chain.readContract({
          address: this.pool,
          abi: dammPoolAbi,
          functionName: "paused",
        }),
        this.protocol.recentFailedTransactions(),
        this.externalMarkets?.operationsSnapshot(
          this.thresholds.externalRouteAgeSeconds,
        ),
      ]);
    const receipts = this.receipts?.metrics();
    const rpcLag = BigInt(readiness.lag ?? "0");
    const checkpointAge = readiness.checkpointUpdatedAt
      ? Math.max(
          0,
          Math.floor(
            (this.now().getTime() -
              new Date(readiness.checkpointUpdatedAt).getTime()) /
              1_000,
          ),
        )
      : Number.POSITIVE_INFINITY;
    const alerts: Alert[] = [
      this.alert(
        "RPC_LAG",
        rpcLag > this.thresholds.rpcLagBlocks,
        rpcLag.toString(),
        this.thresholds.rpcLagBlocks.toString(),
      ),
      this.alert(
        "INDEXING_DRIFT",
        checkpointAge > this.thresholds.checkpointAgeSeconds,
        Number.isFinite(checkpointAge) ? checkpointAge : "missing",
        this.thresholds.checkpointAgeSeconds,
      ),
      this.alert(
        "POOL_BALANCE_DEVIATION",
        !accounting.reconciled,
        accounting.reconciled,
        true,
        "critical",
      ),
      this.alert("POOL_PAUSED", paused === true, paused === true, false),
      this.alert(
        "TRANSACTION_FAILURE_RATE",
        failures >= this.thresholds.recentTransactionFailures,
        failures,
        this.thresholds.recentTransactionFailures,
      ),
      this.alert(
        "EXTERNAL_ROUTE_STALE",
        (externalMarkets?.staleValidatedRoutes ?? 0) > 0,
        externalMarkets?.staleValidatedRoutes ?? 0,
        0,
      ),
      this.alert(
        "TRADE_RECEIPT_FAILURES",
        (receipts?.failures ?? 0) >= this.thresholds.receiptFailures,
        receipts?.failures ?? 0,
        this.thresholds.receiptFailures,
      ),
    ];
    return {
      status: alerts.some((item) => item.active) ? "alert" : "healthy",
      checkedAt: this.now().toISOString(),
      pool: this.pool,
      alerts,
      accounting,
      externalMarkets: externalMarkets ?? null,
      tradeReceipts: receipts ?? null,
    };
  }

  private alert(
    code: string,
    active: boolean,
    observed: Alert["observed"],
    threshold: Alert["threshold"],
    severity: Alert["severity"] = "warning",
  ): Alert {
    return { code, severity, active, observed, threshold };
  }
}

import { dammPoolAbi } from "@zkblast/abi";
import type { ContractReader } from "@zkblast/sdk";
import type { Address } from "viem";
import type { LiquidityService } from "./liquidity-service.js";
import type { ProtocolService } from "./protocol-service.js";

export type OperationsThresholds = Readonly<{
  rpcLagBlocks: bigint;
  checkpointAgeSeconds: number;
  recentTransactionFailures: number;
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
  ) {}

  async health() {
    const [readiness, accounting, paused, failures] = await Promise.all([
      this.protocol.readiness(),
      this.liquidity.accounting(this.pool),
      this.chain.readContract({
        address: this.pool,
        abi: dammPoolAbi,
        functionName: "paused",
      }),
      this.protocol.recentFailedTransactions(),
    ]);
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
    ];
    return {
      status: alerts.some((item) => item.active) ? "alert" : "healthy",
      checkedAt: this.now().toISOString(),
      pool: this.pool,
      alerts,
      accounting,
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

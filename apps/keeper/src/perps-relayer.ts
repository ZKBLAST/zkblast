import postgres from "postgres";
import type { Address, Hex } from "viem";
import { perpsRelaySimulationErrorCode } from "./perps-relay-errors.js";

type RelayJob = Readonly<{
  requestId: Hex;
  adapter: Address;
  calldata: Hex;
  attempts: number;
}>;

export type PerpsRelayChain = Readonly<{
  simulate(input: Readonly<{ from: Address; to: Address; data: Hex }>): Promise<void>;
  estimateGas(input: Readonly<{ from: Address; to: Address; data: Hex }>): Promise<bigint>;
  submit(input: Readonly<{ to: Address; data: Hex; gas: bigint }>): Promise<Hex>;
  receipt(hash: Hex): Promise<"pending" | "success" | "reverted">;
}>;

export class PerpsRelayerWorker {
  readonly #sql: postgres.Sql;
  readonly #schema: string;
  readonly #account: Address;
  readonly #adapter: Address;
  readonly #chain: PerpsRelayChain;
  readonly #maximumGas: bigint;

  constructor(input: Readonly<{
    databaseUrl: string;
    schema: string;
    account: Address;
    adapter: Address;
    chain: PerpsRelayChain;
    maximumGas: bigint;
  }>) {
    if (!/^zkblast_(testnet|mainnet)$/u.test(input.schema) || input.maximumGas <= 21_000n) {
      throw new Error("PERPS_RELAYER_CONFIG_INVALID");
    }
    this.#sql = postgres(input.databaseUrl, { max: 2 });
    this.#schema = input.schema;
    this.#account = input.account;
    this.#adapter = input.adapter;
    this.#chain = input.chain;
    this.#maximumGas = input.maximumGas;
  }

  async tick(): Promise<Readonly<{ claimed: boolean; reconciled: number }>> {
    await this.#recoverAndExpire();
    const reconciled = await this.#reconcileSubmitted();
    const job = await this.#claim();
    if (!job) return { claimed: false, reconciled };
    await this.#execute(job);
    return { claimed: true, reconciled };
  }

  async close(): Promise<void> {
    await this.#sql.end({ timeout: 5 });
  }

  async #claim(): Promise<RelayJob | null> {
    return this.#sql.begin(async (transaction) => {
      const rows = await transaction<Array<{
        requestId: Hex; adapter: Address; calldata: Hex; attempts: number;
      }>>`
        select request_id as "requestId",adapter,calldata,attempts
        from ${transaction(this.#schema)}.perp_relayer_jobs
        where status='queued' and deadline > now() and attempts < 10
        order by created_at for update skip locked limit 1
      `;
      const job = rows[0];
      if (!job) return null;
      if (job.adapter.toLowerCase() !== this.#adapter.toLowerCase()) {
        await transaction`
          update ${transaction(this.#schema)}.perp_relayer_jobs
          set status='failed',error_code='ADAPTER_MISMATCH',updated_at=now()
          where request_id=${job.requestId}
        `;
        return null;
      }
      await transaction`
        update ${transaction(this.#schema)}.perp_relayer_jobs
        set status='processing',attempts=attempts+1,error_code=null,updated_at=now()
        where request_id=${job.requestId}
      `;
      return { ...job, attempts: job.attempts + 1 };
    });
  }

  async #execute(job: RelayJob): Promise<void> {
    try {
      await this.#chain.simulate({ from: this.#account, to: this.#adapter, data: job.calldata });
    } catch (error) {
      await this.#fail(job.requestId, perpsRelaySimulationErrorCode(error));
      return;
    }
    let estimate: bigint;
    try {
      estimate = await this.#chain.estimateGas({ from: this.#account, to: this.#adapter, data: job.calldata });
    } catch {
      await this.#fail(job.requestId, "GAS_ESTIMATE_FAILED");
      return;
    }
    const gas = estimate + estimate / 5n;
    if (gas > this.#maximumGas) {
      await this.#fail(job.requestId, "GAS_LIMIT_EXCEEDED");
      return;
    }
    try {
      const hash = await this.#chain.submit({ to: this.#adapter, data: job.calldata, gas });
      await this.#sql`
        update ${this.#sql(this.#schema)}.perp_relayer_jobs
        set status='submitted',transaction_hash=${hash.toLowerCase()},updated_at=now()
        where request_id=${job.requestId} and status='processing'
      `;
    } catch {
      await this.#fail(job.requestId, "SUBMISSION_FAILED");
    }
  }

  async #reconcileSubmitted(): Promise<number> {
    const rows = await this.#sql<Array<{ requestId: Hex; transactionHash: Hex }>>`
      select request_id as "requestId",transaction_hash as "transactionHash"
      from ${this.#sql(this.#schema)}.perp_relayer_jobs
      where status='submitted' order by updated_at limit 20
    `;
    let reconciled = 0;
    for (const row of rows) {
      const receipt = await this.#chain.receipt(row.transactionHash);
      if (receipt === "pending") continue;
      await this.#sql`
        update ${this.#sql(this.#schema)}.perp_relayer_jobs
        set status=${receipt === "success" ? "confirmed" : "failed"},
          error_code=${receipt === "success" ? null : "TRANSACTION_REVERTED"},updated_at=now()
        where request_id=${row.requestId} and status='submitted'
      `;
      reconciled += 1;
    }
    return reconciled;
  }

  async #recoverAndExpire(): Promise<void> {
    await this.#sql`
      update ${this.#sql(this.#schema)}.perp_relayer_jobs
      set status='expired',error_code='DEADLINE_EXPIRED',updated_at=now()
      where status in ('queued','processing') and deadline <= now()
    `;
    await this.#sql`
      update ${this.#sql(this.#schema)}.perp_relayer_jobs
      set status='queued',error_code='WORKER_RECOVERED',updated_at=now()
      where status='processing' and deadline > now() and attempts < 10
        and updated_at < now() - interval '2 minutes'
    `;
  }

  async #fail(requestId: Hex, code: string): Promise<void> {
    await this.#sql`
      update ${this.#sql(this.#schema)}.perp_relayer_jobs
      set status='failed',error_code=${code},updated_at=now()
      where request_id=${requestId} and status='processing'
    `;
  }
}

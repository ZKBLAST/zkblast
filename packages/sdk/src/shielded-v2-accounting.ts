/** Executable accounting specification only. A circuit and settlement contract
 * must independently enforce these equalities before accepting any proof.
 */
export type PrivateBalanceV2 = Readonly<{
  asset: string;
  amount: bigint;
}>;

export type PrivateTransitionV2 = Readonly<{
  inputNotes: readonly PrivateBalanceV2[];
  outputNotes: readonly PrivateBalanceV2[];
  /** Positive values enter custody from the pool; negatives leave custody. */
  poolDeltas: readonly PrivateBalanceV2[];
  fees: readonly PrivateBalanceV2[];
}>;

const tokenKey = /^token:0x[0-9a-f]{40}$/u;
const shareKey = /^lp:0x[0-9a-f]{40}:(damm:0|dlmm:-?\d+)$/u;

/** LP shares are a different resource from tokens and from other bins/pools. */
function resource(asset: string): string {
  const key = asset.toLowerCase();
  if (!tokenKey.test(key) && !shareKey.test(key)) {
    throw new Error("Invalid v2 resource identity");
  }
  if (BigInt(key.split(":")[1]!) === 0n)
    throw new Error("Zero resource address");
  if (key.startsWith("lp:")) {
    const bin = key.split(":")[3]!;
    const value = BigInt(bin);
    if (String(value) !== bin || value < -(1n << 23n) || value >= 1n << 23n) {
      throw new Error("Invalid canonical LP bin");
    }
  }
  return key;
}

export function assertPrivateConservationV2(
  transition: PrivateTransitionV2,
): void {
  if (
    transition.inputNotes.length === 0 ||
    transition.outputNotes.length === 0
  ) {
    throw new Error("A private transition requires input and output notes");
  }
  const balances = new Map<string, bigint>();
  function accumulate(
    values: readonly PrivateBalanceV2[],
    sign: bigint,
    signed = false,
  ): void {
    for (const entry of values) {
      const key = resource(entry.asset);
      if (
        (!signed && entry.amount < 0n) ||
        entry.amount <= -(1n << 128n) ||
        entry.amount >= 1n << 128n
      ) {
        throw new Error("Invalid resource amount");
      }
      balances.set(key, (balances.get(key) ?? 0n) + sign * entry.amount);
    }
  }
  accumulate(transition.inputNotes, 1n);
  accumulate(transition.poolDeltas, 1n, true);
  accumulate(transition.outputNotes, -1n);
  if (
    transition.fees.some(
      (entry) => resource(entry.asset).startsWith("lp:") && entry.amount !== 0n,
    )
  ) {
    throw new Error("Fees cannot consume LP shares");
  }
  accumulate(transition.fees, -1n);
  for (const [key, amount] of balances) {
    if (amount !== 0n)
      throw new Error(`Private conservation failed for ${key}`);
  }
}

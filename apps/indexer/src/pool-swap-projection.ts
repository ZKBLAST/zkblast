import type { IndexedEvent } from "./domain.js";

export type SwapPool = {
  id: string;
  address: string;
  pool_kind: string;
  token_x_id: string;
  token_y_id: string;
  token_x_address: string;
  token_y_address: string;
};

export function projectPoolSwap(event: IndexedEvent, pool: SwapPool) {
  if (
    event.eventName !== "Swap" ||
    event.kind !== "swap" ||
    event.contractAddress.toLowerCase() !== pool.address.toLowerCase()
  )
    return null;
  const raw = (value: unknown) =>
    typeof value === "string" && /^\d{1,78}$/u.test(value)
      ? BigInt(value)
      : null;
  const amountIn = raw(event.payload.amountIn),
    amountOut = raw(event.payload.amountOut);
  const fee = raw(event.payload.protocolFee),
    timestamp = raw(event.payload.blockTimestamp);
  if (
    !amountIn ||
    !amountOut ||
    fee === null ||
    !timestamp ||
    timestamp > BigInt(Math.floor(Date.now() / 1000)) ||
    timestamp > 253402300799n
  )
    return null;
  let xIn: boolean;
  if (pool.pool_kind === "damm") {
    const tokenIn = String(event.payload.tokenIn).toLowerCase();
    if (![pool.token_x_address, pool.token_y_address].includes(tokenIn))
      return null;
    xIn = tokenIn === pool.token_x_address;
  } else {
    const direction = event.payload.token0ToToken1;
    if (typeof direction !== "boolean") return null;
    xIn = pool.token_x_address < pool.token_y_address === direction;
  }
  return {
    poolId: pool.id,
    tokenInId: xIn ? pool.token_x_id : pool.token_y_id,
    tokenOutId: xIn ? pool.token_y_id : pool.token_x_id,
    amountIn: amountIn.toString(),
    amountOut: amountOut.toString(),
    fee: fee.toString(),
    observedAt: new Date(Number(timestamp) * 1000),
  };
}

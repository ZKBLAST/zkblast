import type { IndexedEvent } from "./domain.js";
import {
  pairOrientation,
  priceFromBin,
  quotePerBaseX18,
} from "@zkblast/sdk";

export type SwapPool = {
  id: string;
  address: string;
  pool_kind: string;
  token_x_id: string;
  token_y_id: string;
  token_x_address: string;
  token_y_address: string;
  token_x_decimals: number;
  token_y_decimals: number;
  quote_token_id: string | null;
  bin_step_bps: number | null;
};

export type ProjectedPoolState = Readonly<{
  reserve0: bigint;
  reserve1: bigint;
  activeBin: number | null;
}>;

function executionPriceX18(
  pool: SwapPool,
  xIn: boolean,
  amountIn: bigint,
  amountOut: bigint,
) {
  const quoteIsX = pool.quote_token_id === pool.token_x_id;
  const quoteRaw = quoteIsX === xIn ? amountIn : amountOut;
  const baseRaw = quoteIsX === xIn ? amountOut : amountIn;
  const quoteDecimals = quoteIsX ? pool.token_x_decimals : pool.token_y_decimals;
  const baseDecimals = quoteIsX ? pool.token_y_decimals : pool.token_x_decimals;
  if (baseRaw === 0n) return null;
  return (
    quoteRaw * 10n ** BigInt(baseDecimals) * 10n ** 18n /
    (baseRaw * 10n ** BigInt(quoteDecimals))
  );
}

const address = (value: unknown) =>
  typeof value === "string" && /^0x[\da-f]{40}$/iu.test(value)
    ? value.toLowerCase()
    : null;

export function poolSpotPriceX18(
  pool: SwapPool,
  reserve0: bigint,
  reserve1: bigint,
  activeBin: number | null,
) {
  if (!pool.quote_token_id) return null;
  const quoteIsX = pool.quote_token_id === pool.token_x_id;
  const orientation = pairOrientation({
    baseAddress: quoteIsX ? pool.token_y_address : pool.token_x_address,
    quoteAddress: quoteIsX ? pool.token_x_address : pool.token_y_address,
    baseDecimals: quoteIsX ? pool.token_y_decimals : pool.token_x_decimals,
    quoteDecimals: quoteIsX ? pool.token_x_decimals : pool.token_y_decimals,
  });
  let token1PerToken0X18: bigint;
  if (pool.pool_kind === "dlmm") {
    if (activeBin === null || !pool.bin_step_bps) return null;
    token1PerToken0X18 = priceFromBin(activeBin, pool.bin_step_bps);
  } else {
    if (reserve0 <= 0n || reserve1 <= 0n) return null;
    token1PerToken0X18 = (reserve1 * 10n ** 18n) / reserve0;
  }
  return quotePerBaseX18(token1PerToken0X18, orientation);
}

export function projectPoolSwap(
  event: IndexedEvent,
  pool: SwapPool,
  previousState: ProjectedPoolState = {
    reserve0: 0n,
    reserve1: 0n,
    activeBin: null,
  },
) {
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
  const quoteIsX = pool.quote_token_id === pool.token_x_id;
  const quoteIsY = pool.quote_token_id === pool.token_y_id;
  const quoteKnown = quoteIsX || quoteIsY;
  if (!quoteKnown) return null;
  const shielded = event.payload.privateExecution === true;
  const sender = shielded ? null : address(event.payload.sender);
  const recipient = address(event.payload.recipient);
  let reserve0 = previousState.reserve0;
  let reserve1 = previousState.reserve1;
  let activeBin = previousState.activeBin;
  const hasDammBaseline = reserve0 > 0n && reserve1 > 0n;
  if (pool.pool_kind === "damm") {
    const netInput = amountIn - fee;
    if (netInput < 0n) return null;
    if (hasDammBaseline) {
      const token0IsX = pool.token_x_address < pool.token_y_address;
      const zeroForOne = xIn === token0IsX;
      if (zeroForOne) {
        if (reserve1 < amountOut) return null;
        reserve0 += netInput;
        reserve1 -= amountOut;
      } else {
        if (reserve0 < amountOut) return null;
        reserve1 += netInput;
        reserve0 -= amountOut;
      }
    }
  } else {
    const finalActiveBin = Number(event.payload.finalActiveBin);
    if (!Number.isInteger(finalActiveBin) || finalActiveBin < -10_000 || finalActiveBin > 10_000)
      return null;
    activeBin = finalActiveBin;
  }
  const spotPrice = pool.pool_kind === "damm" && !hasDammBaseline
    ? executionPriceX18(pool, xIn, amountIn, amountOut)
    : poolSpotPriceX18(pool, reserve0, reserve1, activeBin);
  const quoteIn = quoteIsX === xIn;
  const volumeQuote = quoteIn ? amountIn : amountOut;
  return {
    poolId: pool.id,
    tokenInId: xIn ? pool.token_x_id : pool.token_y_id,
    tokenOutId: xIn ? pool.token_y_id : pool.token_x_id,
    amountIn: amountIn.toString(),
    amountOut: amountOut.toString(),
    fee: fee.toString(),
    side: quoteIn ? "buy" : "sell",
    trader: sender,
    recipient,
    activeBin,
    reserve0After: pool.pool_kind === "damm" && hasDammBaseline ? reserve0.toString() : null,
    reserve1After: pool.pool_kind === "damm" && hasDammBaseline ? reserve1.toString() : null,
    spotPriceX18: spotPrice?.toString() ?? null,
    volumeQuoteRaw: volumeQuote?.toString() ?? null,
    state: pool.pool_kind === "damm" && !hasDammBaseline
      ? null
      : { reserve0, reserve1, activeBin },
    observedAt: new Date(Number(timestamp) * 1000),
  };
}

export function projectDammLiquidity(
  event: IndexedEvent,
  pool: SwapPool,
  previousState: ProjectedPoolState,
) {
  if (
    pool.pool_kind !== "damm" ||
    event.kind !== "liquidity" ||
    !["LiquidityAdded", "LiquidityRemoved"].includes(event.eventName)
  ) return null;
  const raw = (value: unknown) =>
    typeof value === "string" && /^\d{1,78}$/u.test(value) ? BigInt(value) : null;
  const amount0 = raw(event.payload.amount0);
  const amount1 = raw(event.payload.amount1);
  if (amount0 === null || amount1 === null) return null;
  const added = event.eventName === "LiquidityAdded";
  if (!added && (previousState.reserve0 < amount0 || previousState.reserve1 < amount1))
    return null;
  const reserve0 = added ? previousState.reserve0 + amount0 : previousState.reserve0 - amount0;
  const reserve1 = added ? previousState.reserve1 + amount1 : previousState.reserve1 - amount1;
  return {
    reserve0,
    reserve1,
    activeBin: null,
    spotPriceX18: poolSpotPriceX18(pool, reserve0, reserve1, null)?.toString() ?? null,
  };
}

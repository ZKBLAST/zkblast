export type PoolType = "DLMM" | "DAMM";

export type Pool = {
  id: string;
  type: PoolType;
  base: string;
  quote: string;
  feeBps: number;
  binStep?: number; // DLMM only, in bps
  tvlUsd: number;
  volume24hUsd: number;
  fees24hUsd: number;
  apr: number; // percent, trailing 7d fees / TVL annualised
  price: number; // quote per base
  activeBin?: number;
  createdDaysAgo: number;
};

export const pools: Pool[] = [
  { id: "weth-usdc-dlmm-10", type: "DLMM", base: "WETH", quote: "USDC", feeBps: 10, binStep: 10, tvlUsd: 18_204_331, volume24hUsd: 9_412_870, fees24hUsd: 9_412.87, apr: 18.87, price: 3412.21, activeBin: 8_388_812, createdDaysAgo: 142 },
  { id: "wbtc-usdc-dlmm-15", type: "DLMM", base: "WBTC", quote: "USDC", feeBps: 15, binStep: 15, tvlUsd: 11_870_442, volume24hUsd: 4_120_336, fees24hUsd: 6_180.5, apr: 19.0, price: 67842.1, activeBin: 8_390_207, createdDaysAgo: 131 },
  { id: "usdc-usdt-damm-1", type: "DAMM", base: "USDC", quote: "USDT", feeBps: 1, tvlUsd: 22_015_904, volume24hUsd: 31_774_102, fees24hUsd: 3_177.41, apr: 5.27, price: 1.0002, createdDaysAgo: 160 },
  { id: "eth-usdt-dlmm-25", type: "DLMM", base: "ETH", quote: "USDT", feeBps: 25, binStep: 25, tvlUsd: 6_402_118, volume24hUsd: 2_984_211, fees24hUsd: 7_460.53, apr: 42.53, price: 3413.03, activeBin: 8_388_451, createdDaysAgo: 88 },
  { id: "link-weth-damm-30", type: "DAMM", base: "LINK", quote: "WETH", feeBps: 30, tvlUsd: 2_118_744, volume24hUsd: 611_093, fees24hUsd: 1_833.28, apr: 31.58, price: 0.004211, createdDaysAgo: 74 },
  { id: "uni-usdc-dlmm-50", type: "DLMM", base: "UNI", quote: "USDC", feeBps: 50, binStep: 50, tvlUsd: 1_340_559, volume24hUsd: 402_771, fees24hUsd: 2_013.86, apr: 54.83, price: 7.92, activeBin: 8_388_997, createdDaysAgo: 51 },
  { id: "dai-usdc-damm-1", type: "DAMM", base: "DAI", quote: "USDC", feeBps: 1, tvlUsd: 8_771_216, volume24hUsd: 7_005_481, fees24hUsd: 700.55, apr: 2.92, price: 1.0003, createdDaysAgo: 160 },
  { id: "arb-weth-dlmm-40", type: "DLMM", base: "ARB", quote: "WETH", feeBps: 40, binStep: 40, tvlUsd: 905_377, volume24hUsd: 288_640, fees24hUsd: 1_154.56, apr: 46.55, price: 0.0002386, activeBin: 8_387_330, createdDaysAgo: 33 },
  { id: "wbtc-weth-damm-5", type: "DAMM", base: "WBTC", quote: "WETH", feeBps: 5, tvlUsd: 4_660_093, volume24hUsd: 1_377_980, fees24hUsd: 688.99, apr: 5.4, price: 19.882, createdDaysAgo: 97 },
  { id: "link-usdc-dlmm-20", type: "DLMM", base: "LINK", quote: "USDC", feeBps: 20, binStep: 20, tvlUsd: 1_812_604, volume24hUsd: 530_117, fees24hUsd: 1_060.23, apr: 21.35, price: 14.37, activeBin: 8_388_301, createdDaysAgo: 46 },
];

export const poolById = (id: string) => pools.find((p) => p.id === id);

// Deterministic PRNG so server and client render identical dummy data.
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (str: string) => [...str].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export type Bin = { id: number; offset: number; price: number; base: number; quote: number };

// Liquidity distribution around the active bin (DLMM only).
export function binsFor(pool: Pool, radius = 34): Bin[] {
  const rand = seeded(hash(pool.id));
  const step = (pool.binStep ?? 10) / 10_000;
  const out: Bin[] = [];
  for (let o = -radius; o <= radius; o++) {
    const shape = Math.exp(-(o * o) / (2 * (radius / 2.6) ** 2));
    const noise = 0.65 + rand() * 0.7;
    const liq = shape * noise * (pool.tvlUsd / 40);
    out.push({
      id: (pool.activeBin ?? 8_388_608) + o,
      offset: o,
      price: pool.price * Math.pow(1 + step, o),
      // left of active bin holds quote, right holds base, active bin holds both
      quote: o < 0 ? liq : o === 0 ? liq / 2 : 0,
      base: o > 0 ? liq : o === 0 ? liq / 2 : 0,
    });
  }
  return out;
}

// DAMM reserve curve sample points (x*y=k with dynamic fee band).
export function priceHistory(pool: Pool, points = 96) {
  const rand = seeded(hash(pool.id) ^ 0x9e37);
  const out: { t: number; v: number }[] = [];
  let v = pool.price * (0.93 + rand() * 0.04);
  for (let i = 0; i < points; i++) {
    v *= 1 + (rand() - 0.485) * (pool.base.startsWith("USD") || pool.base === "DAI" ? 0.0006 : 0.012);
    out.push({ t: i, v });
  }
  // Rescale so the series ends exactly at the current price.
  const k = pool.price / out[out.length - 1].v;
  return out.map((p) => ({ t: p.t, v: p.v * k }));
}

export type Token = {
  symbol: string;
  name: string;
  decimals: number;
  priceUsd: number;
  change24h: number; // percent
  hue: number; // for the generated token mark, not an official logo
  glyph: string;
  shieldedAllowlisted: boolean;
};

export const tokens: Token[] = [
  { symbol: "ETH", glyph: "Ξ", name: "Ether", decimals: 18, priceUsd: 3412.58, change24h: 2.31, hue: 220, shieldedAllowlisted: false },
  { symbol: "WETH", glyph: "wΞ", name: "Wrapped Ether", decimals: 18, priceUsd: 3412.21, change24h: 2.29, hue: 230, shieldedAllowlisted: true },
  { symbol: "USDC", glyph: "UC", name: "USD Coin", decimals: 6, priceUsd: 1.0, change24h: 0.01, hue: 205, shieldedAllowlisted: true },
  { symbol: "USDT", glyph: "UT", name: "Tether USD", decimals: 6, priceUsd: 0.9998, change24h: -0.02, hue: 160, shieldedAllowlisted: false },
  { symbol: "WBTC", glyph: "₿", name: "Wrapped Bitcoin", decimals: 8, priceUsd: 67842.1, change24h: 1.12, hue: 32, shieldedAllowlisted: false },
  { symbol: "DAI", glyph: "DA", name: "Dai Stablecoin", decimals: 18, priceUsd: 1.0003, change24h: 0.03, hue: 44, shieldedAllowlisted: false },
  { symbol: "LINK", glyph: "LK", name: "Chainlink", decimals: 18, priceUsd: 14.37, change24h: -3.84, hue: 215, shieldedAllowlisted: false },
  { symbol: "UNI", glyph: "UN", name: "Uniswap", decimals: 18, priceUsd: 7.92, change24h: 4.66, hue: 320, shieldedAllowlisted: false },
  { symbol: "ARB", glyph: "AR", name: "Arbitrum", decimals: 18, priceUsd: 0.8143, change24h: -1.27, hue: 210, shieldedAllowlisted: false },
];

export const tokenBySymbol = (s: string) => tokens.find((t) => t.symbol === s)!;

// Simulated wallet balances for the demo account.
export const walletBalances: Record<string, number> = {
  ETH: 4.2817,
  WETH: 1.5,
  USDC: 12_480.55,
  USDT: 3_210.0,
  WBTC: 0.0842,
  DAI: 940.12,
  LINK: 310.4,
  UNI: 0,
  ARB: 2_150.75,
};

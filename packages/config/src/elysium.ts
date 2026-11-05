export const ELYSIUM_TESTNET_CHAIN_ID = 99_801 as const;
export const ELYSIUM_TESTNET_BRIDGE_URL =
  "https://testnet.elysium.kinetiq.xyz/bridge" as const;
export const ELYSIUM_TESTNET_MULTICALL3 =
  "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
export const ELYSIUM_TESTNET_GATEWAY =
  "0x896598Caf3e619996203dd0C77B94C45C81E5395" as const;

export type ElysiumBridgeState =
  | "submitted"
  | "credited"
  | "withdrawal_initiated"
  | "finalizable"
  | "claimed";

export type ElysiumCanonicalAsset = Readonly<{
  chainId: typeof ELYSIUM_TESTNET_CHAIN_ID;
  address: `0x${string}`;
  symbol: "WHYPE" | "USDC";
  name: string;
  decimals: 18 | 6;
  provenance: "official-elysium-testnet-registry";
  quoteAsset: boolean;
  wrappingEnabled: boolean;
}>;

const assets = [
  {
    chainId: ELYSIUM_TESTNET_CHAIN_ID,
    address: "0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234",
    symbol: "WHYPE",
    name: "Wrapped HYPE",
    decimals: 18,
    provenance: "official-elysium-testnet-registry",
    quoteAsset: false,
    wrappingEnabled: false,
  },
  {
    chainId: ELYSIUM_TESTNET_CHAIN_ID,
    address: "0x7D29d8047B905000459c0E80c34a26CeedcB47b2",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    provenance: "official-elysium-testnet-registry",
    quoteAsset: false,
    wrappingEnabled: false,
  },
] as const satisfies readonly ElysiumCanonicalAsset[];

const byAddress = new Map(
  assets.map((asset) => [asset.address.toLowerCase(), asset]),
);

export const elysiumCanonicalAssets: readonly ElysiumCanonicalAsset[] = assets;

export function getElysiumCanonicalAsset(
  chainId: number,
  address: string,
): ElysiumCanonicalAsset {
  if (chainId !== ELYSIUM_TESTNET_CHAIN_ID) {
    throw new Error("ELYSIUM_ASSET_CHAIN_MISMATCH");
  }
  if (!/^0x[\da-f]{40}$/iu.test(address)) {
    throw new Error("ELYSIUM_ASSET_ADDRESS_INVALID");
  }
  const asset = byAddress.get(address.toLowerCase());
  if (!asset) throw new Error("ELYSIUM_ASSET_UNSUPPORTED");
  return asset;
}

export function assertElysiumAssetIdentity(input: {
  chainId: number;
  address: string;
  symbol: string;
  decimals: number;
}): ElysiumCanonicalAsset {
  const asset = getElysiumCanonicalAsset(input.chainId, input.address);
  if (input.symbol !== asset.symbol || input.decimals !== asset.decimals) {
    throw new Error("ELYSIUM_ASSET_IDENTITY_MISMATCH");
  }
  return asset;
}

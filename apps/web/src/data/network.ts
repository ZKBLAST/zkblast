// Environment labels. Every number in this app is simulated until a
// verified deployment manifest replaces it (see docs/DEPLOYMENTS.md).
export type Environment = "testnet" | "mainnet";
export type DataSource = "simulated" | "verified";

export const network = {
  name: "Robinhood Chain Testnet",
  shortName: "RH Testnet",
  environment: "testnet" as Environment,
  dataSource: "simulated" as DataSource,
  chainId: null as number | null, // filled from the deployment manifest, never guessed
  explorerUrl: null as string | null,
  blockTimeSec: 0.25,
  latestBlock: 18_402_117,
};

export const appMeta = {
  name: "ZKBLAST",
  tagline: "Liquidity Without Exposure.",
  positioning: "Zero-Knowledge Liquidity Infrastructure",
};

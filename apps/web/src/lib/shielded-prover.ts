import {
  fetchProverManifest,
  sha256Hex,
  type ProverManifest,
  type ProverNetwork,
} from "@zkblast/config";
import testnetRelease from "@/data/testnet-prover-release.json";
import type { PublicConfig } from "@/types/application";

export function getShieldedProverNetwork(config: PublicConfig): ProverNetwork {
  return {
    environment: config.environment,
    chainId: config.chainId,
    ...(config.environment === "mainnet" &&
    config.shielded?.launchMode === "experimental-single-operator"
      ? { proverTrustModel: "experimental-single-operator" as const }
      : {}),
  };
}

export async function loadShieldedProver(
  config: PublicConfig,
): Promise<ProverManifest> {
  const release =
    config.shielded?.proverRelease ??
    (config.environment === "testnet" ? testnetRelease : undefined);
  if (!release) throw new Error("MAINNET_PROVER_RELEASE_NOT_APPROVED");
  return fetchProverManifest(getShieldedProverNetwork(config), release);
}

export async function checkShieldedProverAssets(
  manifest: ProverManifest,
): Promise<void> {
  await Promise.all(
    Object.values(manifest.assets).map(async (asset) => {
      const response = await fetch(asset.path, {
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error("PROVER_ASSET_UNAVAILABLE");
      if ((await sha256Hex(await response.arrayBuffer())) !== asset.sha256)
        throw new Error("PROVER_ASSET_INTEGRITY_FAILED");
    }),
  );
}

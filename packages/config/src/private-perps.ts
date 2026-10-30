import { z } from "zod";
import { sha256Hex } from "./shielded-prover.js";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const address = z.string().regex(/^0x[0-9a-f]{40}$/iu).refine((value) => BigInt(value) !== 0n);
const environment = z.enum(["testnet", "mainnet"]);
const releaseReference = z.object({
  manifestPath: z.string().regex(/^\/zk\/(testnet|mainnet)\/perps-v1\/manifest\.json$/u),
  manifestSha256: digest,
}).strict();
const actionReference = z.object({
  manifestPath: z.string().regex(/^\/zk\/(testnet|mainnet)\/perps-v1\/[a-z-]+-manifest\.json$/u),
  manifestSha256: digest,
  generatedVerifierSha256: digest,
}).strict();
const calculatorReference = z.object({
  path: z.string().regex(/^\/zk\/(testnet|mainnet)\/perps-v1\/position-vector\.wasm$/u),
  sha256: digest,
}).strict();

export const privatePerpsReleaseIndexSchema = z.object({
  schemaVersion: z.literal(1),
  feature: z.literal("shielded-perps"),
  environment,
  chainId: z.string().regex(/^[1-9][0-9]*$/u),
  adapter: address,
  positionCalculator: calculatorReference,
  actions: z.object({
    open: actionReference,
    close: actionReference,
    modify: actionReference,
    "claim-liquidated": actionReference,
  }).strict(),
}).strict();

export const privatePerpsConfigSchema = z.object({
  registry: address,
  oracle: address,
  funding: address,
  engine: address,
  insuranceFund: address,
  liquidityVault: address,
  shieldedAdapter: address,
  collateral: address,
  deploymentBlock: z.number().int().positive(),
  proverRelease: releaseReference,
  relayer: z.object({ address, feeRaw: z.string().regex(/^\d+$/u) }).strict(),
}).strict();

export type PrivatePerpsConfig = z.infer<typeof privatePerpsConfigSchema>;
export type PrivatePerpsReleaseIndex = z.infer<typeof privatePerpsReleaseIndexSchema>;

export async function fetchPrivatePerpsRelease(
  scope: Readonly<{ environment: "testnet" | "mainnet"; chainId: string; adapter: string }>,
  reference: z.infer<typeof releaseReference>,
  fetcher: typeof fetch = fetch,
): Promise<PrivatePerpsReleaseIndex> {
  if (!reference.manifestPath.startsWith(`/zk/${scope.environment}/perps-v1/`)) {
    throw new Error("PERPS_RELEASE_NETWORK_MISMATCH");
  }
  const response = await fetcher(reference.manifestPath, {
    credentials: "omit", redirect: "error", signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("PERPS_RELEASE_UNAVAILABLE");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 32_768 || await sha256Hex(bytes) !== reference.manifestSha256) {
    throw new Error("PERPS_RELEASE_HASH_MISMATCH");
  }
  const release = privatePerpsReleaseIndexSchema.parse(
    JSON.parse(new TextDecoder().decode(bytes)),
  );
  if (
    release.environment !== scope.environment || release.chainId !== scope.chainId
      || release.adapter.toLowerCase() !== scope.adapter.toLowerCase()
      || Object.values(release.actions).some(
        (action) => !action.manifestPath.startsWith(`/zk/${scope.environment}/perps-v1/`),
      )
  ) throw new Error("PERPS_RELEASE_SCOPE_MISMATCH");
  return release;
}

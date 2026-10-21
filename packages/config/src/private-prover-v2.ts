import { z } from "zod";
import { sha256Hex } from "./shielded-prover.js";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const asset = z
  .object({
    path: z
      .string()
      .regex(
        /^\/zk\/(testnet|mainnet)\/v2\/[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+$/u,
      ),
    sha256: digest,
  })
  .strict();
const bundle = z
  .object({ wasm: asset, zkey: asset, verificationKey: asset })
  .strict();
export const privateProverReleaseRefV2Schema = z
  .object({
    manifestPath: z
      .string()
      .regex(/^\/zk\/(testnet|mainnet)\/v2\/[a-zA-Z0-9_-]+\.json$/u),
    manifestSha256: digest,
  })
  .strict();
export const privateProverManifestV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    environment: z.enum(["testnet", "mainnet"]),
    chainId: z.string().regex(/^[1-9][0-9]{0,19}$/u),
    settlement: z
      .string()
      .regex(/^0x[0-9a-f]{40}$/iu)
      .refine((value) => BigInt(value) !== 0n),
    treeVersion: z.string().regex(/^[1-9][0-9]{0,19}$/u),
    trustModel: z.enum(["single-operator-testnet", "single-operator-mainnet"]),
    noteCalculator: asset,
    action: z
      .object({
        kind: z.literal("action"),
        publicInputs: z.literal(32),
        assets: bundle,
      })
      .strict(),
    fund: z
      .object({
        kind: z.literal("fund"),
        publicInputs: z.literal(11),
        assets: bundle,
      })
      .strict(),
  })
  .strict()
  .superRefine((release, context) => {
    const assets = [
      release.noteCalculator,
      ...Object.values(release.action.assets),
      ...Object.values(release.fund.assets),
    ];
    if (
      !isPrivateV2Network(release.environment, release.chainId) ||
      release.trustModel !== `single-operator-${release.environment}` ||
      assets.some(
        (asset) => !asset.path.startsWith(`/zk/${release.environment}/v2/`),
      )
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "V2_RELEASE_NETWORK_MISMATCH",
      });
  });
export type PrivateProverReleaseRefV2 = z.infer<
  typeof privateProverReleaseRefV2Schema
>;
export const privateVaultV2ConfigSchema = z.object({
  vault: z
    .string()
    .regex(/^0x[0-9a-f]{40}$/iu)
    .refine((value) => BigInt(value) !== 0n),
  fieldHasher: z
    .string()
    .regex(/^0x[0-9a-f]{40}$/iu)
    .refine((value) => BigInt(value) !== 0n),
  treeVersion: z.number().int().positive(),
  deploymentBlock: z.number().int().nonnegative(),
  assets: z
    .array(
      z
        .object({
          address: z.string().regex(/^0x[0-9a-f]{40}$/iu),
          symbol: z.string().regex(/^[A-Z0-9]{2,12}$/u),
          decimals: z.number().int().min(0).max(36),
          enabled: z.boolean(),
        })
        .strict(),
    )
    .refine(
      (assets) =>
        new Set(assets.map((asset) => asset.address.toLowerCase())).size ===
        assets.length,
      "V2_ASSET_DUPLICATE",
    )
    .optional(),
  proverRelease: privateProverReleaseRefV2Schema.optional(),
  verifiedDeployment: z
    .object({
      chainId: z.literal(4663),
      transactionHash: z.string().regex(/^0x[a-f0-9]{64}$/iu),
      verifiedBlock: z.number().int().positive(),
      implementation: z.string().regex(/^0x[a-f0-9]{40}$/iu),
      proxyRuntimeHash: z.string().regex(/^0x[a-f0-9]{64}$/iu),
      implementationRuntimeHash: z.string().regex(/^0x[a-f0-9]{64}$/iu),
      fieldHasherRuntimeHash: z.string().regex(/^0x[a-f0-9]{64}$/iu),
      actionAdapterRuntimeHash: z.string().regex(/^0x[a-f0-9]{64}$/iu),
      fundAdapterRuntimeHash: z.string().regex(/^0x[a-f0-9]{64}$/iu),
      actionGroth16RuntimeHash: z.string().regex(/^0x[a-f0-9]{64}$/iu),
      fundGroth16RuntimeHash: z.string().regex(/^0x[a-f0-9]{64}$/iu),
    })
    .strict()
    .optional(),
});
export type PrivateVaultV2Config = z.infer<typeof privateVaultV2ConfigSchema>;
export type PrivateProverReleaseV2 = z.infer<
  typeof privateProverManifestV2Schema
>;
export type PrivateProverScopeV2 = Readonly<{
  environment: "testnet" | "mainnet";
  chainId: string;
  settlement: string;
  treeVersion: string;
}>;

export function isPrivateV2Network(
  environment: string,
  chainId: string | number,
): boolean {
  return (
    (environment === "testnet" && String(chainId) === "46630") ||
    (environment === "mainnet" && String(chainId) === "4663")
  );
}

export function privateV2ConfigIssue(
  environment: string,
  chainId: number,
  config: PrivateVaultV2Config,
  legacyVault?: string,
): string | null {
  if (environment === "testnet" && config.verifiedDeployment)
    return "V2_RELEASE_NETWORK_MISMATCH";
  if (
    !isPrivateV2Network(environment, chainId) ||
    config.vault.toLowerCase() === legacyVault?.toLowerCase()
  )
    return "V2_VAULT_NOT_ISOLATED";
  if (
    config.proverRelease &&
    !config.proverRelease.manifestPath.startsWith(`/zk/${environment}/v2/`)
  )
    return "V2_RELEASE_NETWORK_MISMATCH";
  if (
    environment === "mainnet" &&
    (!config.proverRelease ||
      !config.verifiedDeployment ||
      config.deploymentBlock <= 0 ||
      config.verifiedDeployment.verifiedBlock < config.deploymentBlock ||
      BigInt(config.verifiedDeployment.implementation) === 0n)
  )
    return "V2_MAINNET_VERIFIED_DEPLOYMENT_REQUIRED";
  return null;
}

/** Seal a staged release without changing any active deployment manifest. */
export async function sealPrivateProverV2(
  value: unknown,
  manifestPath: string,
): Promise<{
  manifest: PrivateProverReleaseV2;
  serialized: string;
  reference: PrivateProverReleaseRefV2;
}> {
  const manifest = privateProverManifestV2Schema.parse(value);
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestSha256 = await sha256Hex(
    new TextEncoder().encode(serialized).buffer,
  );
  const reference = privateProverReleaseRefV2Schema.parse({
    manifestPath,
    manifestSha256,
  });
  if (!reference.manifestPath.startsWith(`/zk/${manifest.environment}/v2/`))
    throw new Error("V2_RELEASE_NETWORK_MISMATCH");
  return { manifest, serialized, reference };
}

export async function fetchPrivateProverV2(
  scope: PrivateProverScopeV2,
  reference: PrivateProverReleaseRefV2,
  fetcher: typeof fetch = fetch,
): Promise<PrivateProverReleaseV2> {
  if (!isPrivateV2Network(scope.environment, scope.chainId))
    throw new Error("V2_PROVER_NETWORK_MISMATCH");
  const release = privateProverReleaseRefV2Schema.parse(reference);
  if (!release.manifestPath.startsWith(`/zk/${scope.environment}/v2/`))
    throw new Error("V2_RELEASE_NETWORK_MISMATCH");
  const response = await fetcher(release.manifestPath, {
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("V2_PROVER_MANIFEST_UNAVAILABLE");
  const declared = Number(response.headers.get("content-length"));
  if (declared > 32_768) throw new Error("V2_PROVER_MANIFEST_TOO_LARGE");
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > 32_768)
    throw new Error("V2_PROVER_MANIFEST_TOO_LARGE");
  if ((await sha256Hex(buffer)) !== release.manifestSha256)
    throw new Error("V2_PROVER_MANIFEST_HASH_MISMATCH");
  const manifest = privateProverManifestV2Schema.parse(
    JSON.parse(new TextDecoder().decode(buffer)),
  );
  if (
    manifest.environment !== scope.environment ||
    manifest.chainId !== scope.chainId ||
    manifest.settlement.toLowerCase() !== scope.settlement.toLowerCase() ||
    manifest.treeVersion !== scope.treeVersion
  )
    throw new Error("V2_PROVER_MANIFEST_SCOPE_MISMATCH");
  return manifest;
}

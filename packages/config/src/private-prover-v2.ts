import { z } from "zod";
import { sha256Hex } from "./shielded-prover.js";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const asset = z
  .object({
    path: z
      .string()
      .regex(/^\/zk\/testnet\/v2\/[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+$/u),
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
      .regex(/^\/zk\/testnet\/v2\/[a-zA-Z0-9_-]+\.json$/u),
    manifestSha256: digest,
  })
  .strict();
export const privateProverManifestV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    environment: z.literal("testnet"),
    chainId: z.string().regex(/^[1-9][0-9]{0,19}$/u),
    settlement: z
      .string()
      .regex(/^0x[0-9a-f]{40}$/iu)
      .refine((value) => BigInt(value) !== 0n),
    treeVersion: z.string().regex(/^[1-9][0-9]{0,19}$/u),
    trustModel: z.literal("single-operator-testnet"),
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
  .strict();
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
  proverRelease: privateProverReleaseRefV2Schema.optional(),
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
  return { manifest, serialized, reference };
}

export async function fetchPrivateProverV2(
  scope: PrivateProverScopeV2,
  reference: PrivateProverReleaseRefV2,
  fetcher: typeof fetch = fetch,
): Promise<PrivateProverReleaseV2> {
  if (scope.environment !== "testnet")
    throw new Error("V2_PROVER_TESTNET_ONLY");
  const release = privateProverReleaseRefV2Schema.parse(reference);
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

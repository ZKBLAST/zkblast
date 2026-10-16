import { z } from "zod";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/u);
const hashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/u);
const integerStringSchema = z.string().regex(/^\d+$/u);

const deploymentRecordSchema = z.object({
  contractName: z.string().min(1),
  proxyKind: z.enum(["uups", "transparent", "beacon", "none"]),
  proxyAddress: addressSchema.nullable(),
  implementationAddress: addressSchema,
  adminAddress: addressSchema.nullable(),
  previousImplementationAddress: addressSchema.nullable(),
  deployerAddress: addressSchema,
  transactionHash: hashSchema,
  blockNumber: z.number().int().nonnegative(),
  blockHash: hashSchema,
  timestamp: z.string().datetime(),
  gasUsed: integerStringSchema,
  effectiveGasPriceWei: integerStringSchema,
  totalFeeWei: integerStringSchema,
  implementationBytecodeHash: hashSchema,
  initializerArguments: z.array(z.unknown()),
  compiler: z.object({
    version: z.string().min(1),
    optimizer: z.boolean(),
    optimizerRuns: z.number().int().nonnegative(),
  }),
  verification: z.object({
    status: z.enum(["pending", "verified", "failed"]),
    url: z.string().url().nullable(),
  }),
});

export const deploymentManifestSchema = z.object({
  schemaVersion: z.literal(1),
  protocol: z.literal("ZKBLAST"),
  environment: z.enum(["testnet", "mainnet"]),
  chainId: z.number().int().positive(),
  chainName: z.string().min(1),
  generatedAt: z.string().datetime(),
  contracts: z.record(z.string(), deploymentRecordSchema),
});

export type DeploymentManifest = z.infer<typeof deploymentManifestSchema>;

type RuntimeNetwork = {
  environment: DeploymentManifest["environment"];
  chainId: number;
};

export function parseDeploymentManifest(
  input: unknown,
  runtime: RuntimeNetwork,
): DeploymentManifest {
  const manifest = deploymentManifestSchema.parse(input);

  if (manifest.environment !== runtime.environment) {
    throw new Error(
      `Deployment environment mismatch: expected ${runtime.environment}, received ${manifest.environment}`,
    );
  }

  if (manifest.chainId !== runtime.chainId) {
    throw new Error(
      `Deployment chain mismatch: expected ${runtime.chainId}, received ${manifest.chainId}`,
    );
  }

  return manifest;
}

export function getContractAddress(
  manifest: DeploymentManifest,
  contractName: string,
): string {
  const deployment = manifest.contracts[contractName];
  if (!deployment) {
    throw new Error(
      `Contract ${contractName} is missing from the deployment manifest`,
    );
  }

  return deployment.proxyAddress ?? deployment.implementationAddress;
}

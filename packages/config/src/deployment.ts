import { z } from "zod";
import {
  privateVaultV2ConfigSchema,
  privateV2ConfigIssue,
} from "./private-prover-v2.js";
import { privatePerpsConfigSchema } from "./private-perps.js";

const addressSchema = z
  .string()
  .regex(/^0x[\da-f]{40}$/iu, "Invalid EVM address");
const hashSchema = z.string().regex(/^0x[\da-f]{64}$/iu, "Invalid EVM hash");
const unsignedIntegerSchema = z
  .string()
  .regex(/^\d+$/u, "Expected an unsigned integer string");

const transactionSchema = z.object({
  hash: hashSchema,
  contractAddress: addressSchema.nullable(),
  blockNumber: z.number().int().nonnegative(),
  blockHash: hashSchema,
  gasUsed: unsignedIntegerSchema,
  effectiveGasPriceWei: unsignedIntegerSchema,
  totalFeeWei: unsignedIntegerSchema,
  status: z.literal("success"),
});

const verificationStatusSchema = z.enum(["pending", "verified", "failed"]);

const contractDeploymentSchema = z
  .object({
    contractName: z.string().min(1),
    proxyKind: z.enum(["uups", "none"]),
    proxyAddress: addressSchema.nullable(),
    implementationAddress: addressSchema,
    deployerAddress: addressSchema,
    governanceAddress: addressSchema.nullable(),
    upgraderAddress: addressSchema.nullable(),
    artifactBytecodeHash: hashSchema,
    deployedRuntimeBytecodeHash: hashSchema,
    initializerCalldataHash: hashSchema.nullable(),
    initializerArguments: z.array(z.unknown()),
    transactions: z.object({
      implementationDeployment: transactionSchema,
      proxyDeploymentAndInitialization: transactionSchema.nullable(),
      configuration: z.array(transactionSchema),
    }),
    upgrades: z.array(
      z.object({
        previousImplementationAddress: addressSchema,
        newImplementationAddress: addressSchema,
        implementationDeployment: transactionSchema,
        proxyUpgrade: transactionSchema,
      }),
    ),
    compiler: z.object({
      version: z.string().min(1),
      optimizer: z.boolean(),
      optimizerRuns: z.number().int().nonnegative(),
    }),
    verification: z.object({
      implementation: verificationStatusSchema,
      proxy: z.union([verificationStatusSchema, z.literal("not_applicable")]),
      urls: z.array(z.string().url()),
    }),
  })
  .superRefine((contract, context) => {
    const isProxy = contract.proxyKind === "uups";
    if (isProxy !== Boolean(contract.proxyAddress)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Proxy address does not match proxy kind",
      });
    }
    if (
      isProxy !==
      Boolean(contract.transactions.proxyDeploymentAndInitialization)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Proxy transaction does not match proxy kind",
      });
    }
    if (isProxy !== Boolean(contract.initializerCalldataHash)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Initializer hash does not match proxy kind",
      });
    }
  });

export const deploymentManifestSchema = z
  .object({
    schemaVersion: z.literal(2),
    protocol: z.literal("ZKBLAST"),
    environment: z.enum(["testnet", "mainnet"]),
    chainId: z.number().int().positive(),
    chainName: z.string().min(1),
    generatedAt: z.string().datetime(),
    deploymentBlock: z.number().int().nonnegative(),
    deploymentBlockHash: hashSchema,
    deployerAddress: addressSchema,
    governanceAddress: addressSchema,
    upgraderAddress: addressSchema,
    contracts: z.record(z.string().min(1), contractDeploymentSchema),
    roles: z.object({
      defaultAdmin: addressSchema,
      upgrader: addressSchema,
      factory: addressSchema,
    }),
    totals: z.object({
      transactionCount: z.number().int().positive(),
      gasUsed: unsignedIntegerSchema,
      totalFeeWei: unsignedIntegerSchema,
    }),
    integration: z.object({
      poolRegistry: addressSchema,
      poolFactory: addressSchema,
      swapRouter: addressSchema,
      positionManager: addressSchema,
      poolQuoter: addressSchema,
    }),
    shieldedV2: privateVaultV2ConfigSchema.optional(),
    perps: privatePerpsConfigSchema.optional(),
    shielded: z
      .object({
        vault: addressSchema,
        stateRegistry: addressSchema,
        fieldHasher: addressSchema,
        treeVersion: z.number().int().positive(),
        deploymentBlock: z.number().int().nonnegative(),
        launchMode: z
          .enum(["independent-reviewed", "experimental-single-operator"])
          .optional(),
        proverRelease: z
          .object({
            manifestPath: z
              .string()
              .regex(/^\/zk\/mainnet\/[a-zA-Z0-9._-]+\.json$/u),
            manifestSha256: z.string().regex(/^[a-f0-9]{64}$/u),
          })
          .optional(),
        assets: z.array(
          z.object({
            address: addressSchema,
            symbol: z.string().min(1),
            decimals: z.number().int().min(0).max(255),
            denominationRaw: unsignedIntegerSchema,
          }),
        ),
      })
      .optional(),
  })
  .superRefine((manifest, context) => {
    if (
      manifest.shieldedV2 &&
      privateV2ConfigIssue(
        manifest.environment,
        manifest.chainId,
        manifest.shieldedV2,
        manifest.shielded?.vault,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["shieldedV2"],
        message: privateV2ConfigIssue(
          manifest.environment,
          manifest.chainId,
          manifest.shieldedV2,
          manifest.shielded?.vault,
        )!,
      });
    }
    if (
      manifest.environment === "mainnet" &&
      manifest.shielded &&
      !manifest.shielded.proverRelease
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["shielded", "proverRelease"],
        message:
          "Shielded mainnet requires a pinned, mainnet-specific prover release",
      });
    }
  });

export type DeploymentManifest = z.infer<typeof deploymentManifestSchema>;

type RuntimeNetwork = Readonly<{
  environment: DeploymentManifest["environment"];
  chainId: number;
}>;

export function parseDeploymentManifest(
  input: unknown,
  runtime?: RuntimeNetwork,
): DeploymentManifest {
  const manifest = deploymentManifestSchema.parse(input);
  if (runtime && manifest.environment !== runtime.environment) {
    throw new Error(
      `Deployment environment mismatch: expected ${runtime.environment}, received ${manifest.environment}`,
    );
  }
  if (runtime && manifest.chainId !== runtime.chainId) {
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
  const contract = manifest.contracts[contractName];
  if (!contract)
    throw new Error(
      `Contract is missing from deployment manifest: ${contractName}`,
    );
  return contract.proxyAddress ?? contract.implementationAddress;
}

import type { DeploymentManifest } from "@zkblast/config";

type PublicContract = Readonly<{
  name: string;
  proxyKind: "uups" | "none";
  address: string;
  proxyAddress: string | null;
  implementationAddress: string;
  verification: Readonly<{
    implementation: "pending" | "verified" | "failed";
    proxy: "pending" | "verified" | "failed" | "not_applicable";
    urls: readonly string[];
  }>;
}>;

const addressPattern = /^0x[\da-f]{40}$/iu;

function contractLabel(group: string, key: string) {
  const words = key
    .replace(/([a-z\d])([A-Z])/gu, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/gu, "$1 $2");
  return `${group} · ${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function directContracts(
  group: "DBC" | "Launchpad",
  values: Readonly<Record<string, unknown>>,
): PublicContract[] {
  return Object.entries(values).flatMap(([key, value]) => {
    if (typeof value !== "string" || !addressPattern.test(value)) return [];
    return [
      {
        name: contractLabel(group, key),
        proxyKind: "none" as const,
        address: value,
        proxyAddress: null,
        implementationAddress: value,
        verification: {
          implementation: "pending" as const,
          proxy: "not_applicable" as const,
          urls: [],
        },
      },
    ];
  });
}

export function publicContractDirectory(
  manifest: DeploymentManifest,
): readonly PublicContract[] {
  const core: PublicContract[] = Object.values(manifest.contracts).map(
    (contract) => ({
      name: contract.contractName,
      proxyKind: contract.proxyKind,
      address: contract.proxyAddress ?? contract.implementationAddress,
      proxyAddress: contract.proxyAddress,
      implementationAddress: contract.implementationAddress,
      verification: contract.verification,
    }),
  );
  const dbc = manifest.dbc
    ? directContracts("DBC", manifest.dbc)
    : [];
  const launchpad = manifest.launchpad
    ? directContracts("Launchpad", manifest.launchpad)
    : [];

  return [...core, ...dbc, ...launchpad].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

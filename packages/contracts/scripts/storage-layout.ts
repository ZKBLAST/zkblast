import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type StorageEntry = Readonly<{
  astId: number;
  contract: string;
  label: string;
  offset: number;
  slot: string;
  type: string;
}>;
type StorageType = Readonly<{
  encoding: string;
  label: string;
  numberOfBytes: string;
}>;
type StorageLayout = Readonly<{
  storage: readonly StorageEntry[];
  types: Readonly<Record<string, StorageType>>;
}>;
type Snapshot = Readonly<Record<string, StorageLayout>>;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const v2 = process.argv.includes("--v2");
const baselinePath = path.join(
  root,
  "storage-layout",
  v2 ? "baseline-v2.json" : "baseline.json",
);
const contracts = v2
  ? ["PrivateVaultV2"]
  : ([
      "PoolRegistry",
      "PoolFactory",
      "SwapRouter",
      "PositionManager",
      "ZKBlastVault",
    ] as const);

async function currentSnapshot(): Promise<Snapshot> {
  return Object.fromEntries(
    await Promise.all(
      contracts.map(async (name) => {
        const artifact = JSON.parse(
          await readFile(
            path.join(root, "out", `${name}.sol`, `${name}.json`),
            "utf8",
          ),
        ) as { storageLayout?: StorageLayout };
        if (!artifact.storageLayout) {
          throw new Error(
            `${name}: storageLayout missing; rebuild with Foundry first`,
          );
        }
        return [name, artifact.storageLayout] as const;
      }),
    ),
  );
}

function assertCompatible(
  name: string,
  baseline: StorageLayout,
  current: StorageLayout,
): void {
  if (current.storage.length < baseline.storage.length) {
    throw new Error(`${name}: storage entries were removed`);
  }
  baseline.storage.forEach((previous, index) => {
    const next = current.storage[index];
    if (
      !next ||
      previous.label !== next.label ||
      previous.slot !== next.slot ||
      previous.offset !== next.offset
    ) {
      throw new Error(
        `${name}: incompatible storage entry at index ${index} (${previous.label})`,
      );
    }
    const previousType = baseline.types[previous.type];
    const nextType = current.types[next.type];
    if (
      !previousType ||
      !nextType ||
      previousType.encoding !== nextType.encoding ||
      previousType.label !== nextType.label ||
      previousType.numberOfBytes !== nextType.numberOfBytes
    ) {
      throw new Error(
        `${name}: incompatible storage type for ${previous.label}`,
      );
    }
  });
}

const current = await currentSnapshot();
if (process.argv.includes("--write")) {
  await mkdir(path.dirname(baselinePath), { recursive: true });
  await writeFile(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Storage layout baseline written: ${contracts.length} contracts`);
} else {
  const baseline = JSON.parse(await readFile(baselinePath, "utf8")) as Snapshot;
  for (const name of contracts) {
    const previous = baseline[name];
    const next = current[name];
    if (!previous || !next) throw new Error(`${name}: storage layout missing`);
    assertCompatible(name, previous, next);
  }
  console.log(
    `Storage layout compatibility passed: ${contracts.length} contracts`,
  );
}

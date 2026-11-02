import { getAddress, type Address, type Hex } from "viem";
import type { LaunchpadAddresses } from "@zkblast/sdk";

export type LaunchpadPresetRecord = Readonly<{
  familyId: Hex;
  configHash: Hex;
  dbcTemplateId: bigint;
  quoteToken: Address;
  maximumTotalTradeFeeBps: number;
  graduationDestination: number;
  creatorAccess: number;
  maximumLaunches: number;
  version: number;
  enabled: boolean;
  used: boolean;
}>;
export type LaunchpadRecord = Readonly<{
  owner: Address;
  pendingOwner: Address;
  treasury: Address;
  pendingTreasury: Address;
  operator: Address;
  metadataHash: Hex;
  slugCommitment: Hex;
  configPresetId: bigint;
  version: number;
  status: number;
  createdAt: bigint;
  updatedAt: bigint;
}>;

export interface LaunchpadPresetReader {
  launchpadCount(): Promise<bigint>;
  presetCount(): Promise<bigint>;
  presets(ids: readonly bigint[]): Promise<readonly LaunchpadPresetRecord[]>;
  globalMaximumTotalTradeFeeBps(): Promise<number>;
  destinationSupported(destination: number): Promise<boolean>;
  launchpad(id: bigint): Promise<LaunchpadRecord>;
  launchpads(ids: readonly bigint[]): Promise<readonly LaunchpadRecord[]>;
}

export class LaunchpadCatalogService {
  constructor(
    private readonly environment: "testnet" | "mainnet",
    private readonly chainId: number,
    private readonly addresses: LaunchpadAddresses,
    private readonly reader: LaunchpadPresetReader,
  ) {}

  configuration() {
    return {
      environment: this.environment,
      chainId: this.chainId,
      abiVersion: this.addresses.abiVersion,
      registry: this.addresses.registry,
      configManager: this.addresses.configManager,
      factory: this.addresses.factory,
      lens: this.addresses.lens,
      feeController: this.addresses.feeController,
      revenueSplitter: this.addresses.revenueSplitter,
      feeCollector: this.addresses.feeCollector,
      tokenFactory: this.addresses.tokenFactory,
    };
  }

  async approvedPresets() {
    const count = await this.reader.presetCount();
    if (count > 100n) throw new Error("LAUNCHPAD_PRESET_COUNT_UNSUPPORTED");
    const ids = Array.from({ length: Number(count) }, (_, index) =>
      BigInt(index + 1),
    );
    const [items, globalFeeCapBps, dammSupported, dlmmSupported] = await Promise.all([
      ids.length ? this.reader.presets(ids) : Promise.resolve([]),
      this.reader.globalMaximumTotalTradeFeeBps(),
      this.reader.destinationSupported(1),
      this.reader.destinationSupported(2),
    ]);
    if (items.length !== ids.length)
      throw new Error("LAUNCHPAD_PRESET_RESPONSE_INVALID");
    return {
      globalFeeCapBps,
      capabilities: {
        dammGraduation: dammSupported,
        dlmmGraduation: dlmmSupported,
      },
      items: items.flatMap((item, index) =>
        item.enabled
          && (item.graduationDestination === 1
            ? dammSupported
            : item.graduationDestination === 2
              ? dlmmSupported
              : false)
          ? [
              {
                presetId: ids[index]!.toString(),
                familyId: item.familyId,
                configHash: item.configHash,
                dbcTemplateId: item.dbcTemplateId.toString(),
                quoteToken: getAddress(item.quoteToken),
                maximumTotalTradeFeeBps: item.maximumTotalTradeFeeBps,
                graduationDestination: item.graduationDestination,
                creatorAccess: item.creatorAccess,
                maximumLaunches: item.maximumLaunches,
                version: item.version,
                used: item.used,
              },
            ]
          : [],
      ),
    };
  }

  async launchpad(id: bigint) {
    if (id <= 0n) throw new Error("LAUNCHPAD_ID_INVALID");
    return this.serializeLaunchpad(id, await this.reader.launchpad(id));
  }

  async ownedLaunchpads(owner: Address) {
    const count = await this.reader.launchpadCount();
    if (count > 500n) throw new Error("LAUNCHPAD_OWNER_SCAN_LIMIT_EXCEEDED");
    const ids = Array.from({ length: Number(count) }, (_, index) =>
      BigInt(index + 1),
    );
    const records = ids.length ? await this.reader.launchpads(ids) : [];
    if (records.length !== ids.length)
      throw new Error("LAUNCHPAD_RECORD_RESPONSE_INVALID");
    const normalizedOwner = getAddress(owner);
    return {
      items: records.flatMap((record, index) =>
        getAddress(record.owner) === normalizedOwner
          ? [this.serializeLaunchpad(ids[index]!, record)]
          : [],
      ),
    };
  }

  private serializeLaunchpad(id: bigint, item: LaunchpadRecord) {
    return {
      launchpadId: id.toString(),
      owner: getAddress(item.owner),
      pendingOwner: getAddress(item.pendingOwner),
      treasury: getAddress(item.treasury),
      pendingTreasury: getAddress(item.pendingTreasury),
      operator: getAddress(item.operator),
      metadataHash: item.metadataHash,
      slugCommitment: item.slugCommitment,
      configPresetId: item.configPresetId.toString(),
      version: item.version,
      status: item.status,
      createdAt: item.createdAt.toString(),
      updatedAt: item.updatedAt.toString(),
    };
  }
}

import {
  launchpadBrandingHash,
  launchpadBrandingSchema,
  validateLaunchpadImage,
  type LaunchpadBranding,
  type LaunchpadImage,
} from "@zkblast/database";
import { getAddress, recoverMessageAddress, type Address, type Hex } from "viem";

export type StoredLaunchpadBranding = Readonly<{
  branding: LaunchpadBranding;
  version: number;
  ownerAddress: Address;
  metadataHash: Hex;
  signature: Hex;
  signedAt: Date;
  logo: LaunchpadImage | null;
  favicon: LaunchpadImage | null;
}>;

export interface LaunchpadBrandingStore {
  save(input: StoredLaunchpadBranding): Promise<void>;
  bySlug(slug: string): Promise<StoredLaunchpadBranding | null>;
}

export interface LaunchpadOwnershipReader {
  launchpad(launchpadId: bigint): Promise<Readonly<{ owner: Address; metadataHash: Hex }>>;
}

export type BrandingImageInput = Readonly<{
  mime: string;
  base64: string;
}> | null;

export function launchpadBrandingMessage(input: Readonly<{
  chainId: number;
  launchpadId: string;
  version: number;
  metadataHash: Hex;
  signedAt: string;
}>): string {
  return [
    "ZKBLAST Launchpad Branding",
    `Chain ID: ${input.chainId}`,
    `Launchpad ID: ${input.launchpadId}`,
    `Version: ${input.version}`,
    `Metadata Hash: ${input.metadataHash}`,
    `Signed At: ${input.signedAt}`,
  ].join("\n");
}

function decodeImage(kind: "logo" | "favicon", input: BrandingImageInput) {
  if (!input) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(input.base64))
    throw new Error("LAUNCHPAD_IMAGE_BASE64_INVALID");
  return validateLaunchpadImage(kind, input.mime, Buffer.from(input.base64, "base64"));
}

export class LaunchpadBrandingService {
  constructor(
    private readonly chainId: number,
    private readonly store: LaunchpadBrandingStore,
    private readonly ownership: LaunchpadOwnershipReader,
  ) {}

  async publish(input: Readonly<{
    branding: unknown;
    version: number;
    ownerAddress: string;
    signature: Hex;
    signedAt: string;
    logo: BrandingImageInput;
    favicon: BrandingImageInput;
  }>): Promise<StoredLaunchpadBranding> {
    const branding = launchpadBrandingSchema.parse(input.branding);
    if (!Number.isSafeInteger(input.version) || input.version < 1)
      throw new Error("LAUNCHPAD_BRANDING_VERSION_INVALID");
    const signedAt = new Date(input.signedAt);
    if (!Number.isFinite(signedAt.getTime())) throw new Error("LAUNCHPAD_SIGNED_AT_INVALID");
    if (Math.abs(Date.now() - signedAt.getTime()) > 15 * 60_000)
      throw new Error("LAUNCHPAD_SIGNATURE_EXPIRED");
    const logo = decodeImage("logo", input.logo);
    const favicon = decodeImage("favicon", input.favicon);
    const metadataHash = launchpadBrandingHash(branding, {
      logo: logo?.bytes ?? null,
      favicon: favicon?.bytes ?? null,
    });
    const message = launchpadBrandingMessage({
      chainId: this.chainId,
      launchpadId: branding.launchpadId,
      version: input.version,
      metadataHash,
      signedAt: signedAt.toISOString(),
    });
    const signer = await recoverMessageAddress({ message, signature: input.signature });
    const requestedOwner = getAddress(input.ownerAddress);
    const onchain = await this.ownership.launchpad(BigInt(branding.launchpadId));
    if (signer !== requestedOwner || requestedOwner !== getAddress(onchain.owner))
      throw new Error("LAUNCHPAD_OWNER_SIGNATURE_INVALID");
    if (metadataHash.toLowerCase() !== onchain.metadataHash.toLowerCase())
      throw new Error("LAUNCHPAD_METADATA_COMMITMENT_MISMATCH");
    const record: StoredLaunchpadBranding = {
      branding,
      version: input.version,
      ownerAddress: requestedOwner,
      metadataHash,
      signature: input.signature,
      signedAt,
      logo,
      favicon,
    };
    await this.store.save(record);
    return record;
  }

  async bySlug(slug: string) {
    return this.store.bySlug(slug);
  }
}

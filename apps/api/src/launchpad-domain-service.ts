import { createHash, randomBytes } from "node:crypto";
import { getAddress, recoverMessageAddress, type Address, type Hex } from "viem";
import type { LaunchpadOwnershipReader } from "./launchpad-branding-service.js";

export type LaunchpadDomainStatus = "pending" | "verified" | "expired" | "revoked";
export type LaunchpadDomainRecord = Readonly<{
  domainId: string;
  launchpadId: string;
  hostname: string;
  status: LaunchpadDomainStatus;
  challengeHash: string;
  challengeExpiresAt: Date;
  verifiedAt: Date | null;
  revokedAt: Date | null;
}>;

export interface LaunchpadDomainStore {
  issue(input: Readonly<{
    launchpadId: string;
    hostname: string;
    challengeHash: string;
    challengeExpiresAt: Date;
  }>): Promise<LaunchpadDomainRecord>;
  domain(domainId: string): Promise<LaunchpadDomainRecord | null>;
  markVerified(domainId: string, verifiedAt: Date): Promise<void>;
  markRevoked(domainId: string, revokedAt: Date): Promise<void>;
}

export interface TxtResolver {
  resolveTxt(hostname: string): Promise<readonly (readonly string[])[]>;
}

export function normalizeLaunchpadHostname(value: string): string {
  const hostname = value.trim().toLowerCase().replace(/\.$/u, "");
  if (
    hostname.length > 253
      || !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/u.test(hostname)
      || hostname.endsWith(".localhost")
  ) throw new Error("LAUNCHPAD_DOMAIN_INVALID");
  return hostname;
}

export function launchpadDomainMessage(input: Readonly<{
  action: "issue" | "verify" | "revoke";
  chainId: number;
  launchpadId: string;
  hostname: string;
  signedAt: string;
}>): string {
  return [
    "ZKBLAST Launchpad Domain",
    `Action: ${input.action}`,
    `Chain ID: ${input.chainId}`,
    `Launchpad ID: ${input.launchpadId}`,
    `Hostname: ${input.hostname}`,
    `Signed At: ${input.signedAt}`,
  ].join("\n");
}

export class LaunchpadDomainService {
  constructor(
    private readonly chainId: number,
    private readonly store: LaunchpadDomainStore,
    private readonly ownership: LaunchpadOwnershipReader,
    private readonly resolver: TxtResolver,
  ) {}

  async issue(input: Readonly<{
    launchpadId: string;
    hostname: string;
    ownerAddress: string;
    signature: Hex;
    signedAt: string;
  }>) {
    const hostname = normalizeLaunchpadHostname(input.hostname);
    await this.#verifyOwner("issue", { ...input, hostname });
    const challenge = `zkblast-domain=${randomBytes(24).toString("hex")}`;
    const challengeHash = createHash("sha256").update(challenge).digest("hex");
    const record = await this.store.issue({
      launchpadId: input.launchpadId,
      hostname,
      challengeHash,
      challengeExpiresAt: new Date(Date.now() + 30 * 60_000),
    });
    return {
      ...record,
      challenge,
      recordName: `_zkblast-challenge.${hostname}`,
    };
  }

  async verify(input: Readonly<{
    domainId: string;
    ownerAddress: string;
    signature: Hex;
    signedAt: string;
  }>) {
    const record = await this.#record(input.domainId);
    await this.#verifyOwner("verify", { ...input, launchpadId: record.launchpadId, hostname: record.hostname });
    if (record.status === "revoked") throw new Error("LAUNCHPAD_DOMAIN_REVOKED");
    if (record.challengeExpiresAt.getTime() <= Date.now())
      throw new Error("LAUNCHPAD_DOMAIN_CHALLENGE_EXPIRED");
    const values = await this.resolver.resolveTxt(`_zkblast-challenge.${record.hostname}`);
    const matched = values.some((segments) =>
      createHash("sha256").update(segments.join("")).digest("hex") === record.challengeHash,
    );
    if (!matched) throw new Error("LAUNCHPAD_DOMAIN_CHALLENGE_MISMATCH");
    const verifiedAt = new Date();
    await this.store.markVerified(record.domainId, verifiedAt);
    return { ...record, status: "verified" as const, verifiedAt };
  }

  async revoke(input: Readonly<{
    domainId: string;
    ownerAddress: string;
    signature: Hex;
    signedAt: string;
  }>) {
    const record = await this.#record(input.domainId);
    await this.#verifyOwner("revoke", { ...input, launchpadId: record.launchpadId, hostname: record.hostname });
    const revokedAt = new Date();
    await this.store.markRevoked(record.domainId, revokedAt);
    return { ...record, status: "revoked" as const, revokedAt };
  }

  async #record(domainId: string) {
    const record = await this.store.domain(domainId);
    if (!record) throw new Error("LAUNCHPAD_DOMAIN_NOT_FOUND");
    return record;
  }

  async #verifyOwner(
    action: "issue" | "verify" | "revoke",
    input: Readonly<{
      launchpadId: string;
      hostname: string;
      ownerAddress: string;
      signature: Hex;
      signedAt: string;
    }>,
  ) {
    if (!/^[1-9]\d*$/u.test(input.launchpadId)) throw new Error("LAUNCHPAD_ID_INVALID");
    const signedAt = new Date(input.signedAt);
    if (!Number.isFinite(signedAt.getTime()) || Math.abs(Date.now() - signedAt.getTime()) > 15 * 60_000)
      throw new Error("LAUNCHPAD_DOMAIN_SIGNATURE_EXPIRED");
    const message = launchpadDomainMessage({
      action,
      chainId: this.chainId,
      launchpadId: input.launchpadId,
      hostname: input.hostname,
      signedAt: signedAt.toISOString(),
    });
    const signer = await recoverMessageAddress({ message, signature: input.signature });
    const requestedOwner = getAddress(input.ownerAddress);
    const onchain = await this.ownership.launchpad(BigInt(input.launchpadId));
    if (signer !== requestedOwner || requestedOwner !== getAddress(onchain.owner))
      throw new Error("LAUNCHPAD_DOMAIN_OWNER_INVALID");
  }
}

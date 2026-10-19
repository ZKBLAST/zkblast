import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  compactSignatureToSignature,
  parseCompactSignature,
  serializeSignature,
  verifyMessage,
} from "viem";
import { z } from "zod";

const walletAddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/u)
  .transform((value) => value.toLowerCase());

const signatureSchema = z
  .string()
  .regex(/^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/u);

function normalizeSignature(signature: string): `0x${string}` {
  if (signature.length !== 130) return signature as `0x${string}`;

  return serializeSignature(
    compactSignatureToSignature(
      parseCompactSignature(signature as `0x${string}`),
    ),
  );
}

export type LoginChallenge = Readonly<{
  id: string;
  walletAddress: string;
  nonceHash: string;
  messageHash: string;
  message: string;
  expiresAt: Date;
}>;

export type AuthenticatedSession = Readonly<{
  userId: string;
  walletId: string;
  sessionToken: string;
  expiresAt: Date;
}>;

export interface AuthStore {
  createChallenge(challenge: LoginChallenge): Promise<void>;
  consumeChallenge(input: {
    challengeId: string;
    walletAddress: string;
    nonceHash: string;
    messageHash: string;
    sessionTokenHash: string;
    sessionExpiresAt: Date;
  }): Promise<Readonly<{ userId: string; walletId: string }>>;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class AuthService {
  public constructor(
    private readonly store: AuthStore,
    private readonly config: Readonly<{
      chainId: number;
      domain: string;
      origin: string;
      challengeTtlMs?: number;
      sessionTtlMs?: number;
    }>,
  ) {}

  public async createChallenge(walletAddressInput: string) {
    const walletAddress = walletAddressSchema.parse(walletAddressInput);
    const nonce = randomBytes(16).toString("hex");
    const id = randomUUID();
    const issuedAt = new Date();
    const expiresAt = new Date(
      issuedAt.getTime() + (this.config.challengeTtlMs ?? 5 * 60_000),
    );
    const message = [
      `${this.config.domain} wants you to sign in with your Ethereum account:`,
      walletAddress,
      "",
      "Sign in to ZKBLAST.",
      "",
      `URI: ${this.config.origin}`,
      "Version: 1",
      `Chain ID: ${this.config.chainId}`,
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt.toISOString()}`,
      `Expiration Time: ${expiresAt.toISOString()}`,
    ].join("\n");

    await this.store.createChallenge({
      id,
      walletAddress,
      nonceHash: hash(nonce),
      messageHash: hash(message),
      message,
      expiresAt,
    });

    return { challengeId: id, message, expiresAt: expiresAt.toISOString() };
  }

  public async verifyChallenge(input: {
    challengeId: string;
    walletAddress: string;
    message: string;
    signature: string;
  }): Promise<AuthenticatedSession> {
    const challengeId = z.string().uuid().parse(input.challengeId);
    const walletAddress = walletAddressSchema.parse(input.walletAddress);
    const signature = normalizeSignature(
      signatureSchema.parse(input.signature),
    );
    const nonce = /^Nonce: ([a-f0-9]{32})$/mu.exec(input.message)?.[1];
    if (!nonce) throw new Error("INVALID_LOGIN_MESSAGE");

    const signatureValid = await verifyMessage({
      address: walletAddress as `0x${string}`,
      message: input.message,
      signature,
    });
    if (!signatureValid) throw new Error("INVALID_WALLET_SIGNATURE");

    const sessionToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(
      Date.now() + (this.config.sessionTtlMs ?? 7 * 24 * 60 * 60_000),
    );
    const identity = await this.store.consumeChallenge({
      challengeId,
      walletAddress,
      nonceHash: hash(nonce),
      messageHash: hash(input.message),
      sessionTokenHash: hash(sessionToken),
      sessionExpiresAt: expiresAt,
    });

    return { ...identity, sessionToken, expiresAt };
  }
}

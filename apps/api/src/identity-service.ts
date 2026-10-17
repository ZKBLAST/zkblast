import { createHash } from "node:crypto";
import { z } from "zod";

const sessionTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const usernameSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_]{3,24}$/u);

export type SessionIdentity = Readonly<{ userId: string; walletId: string }>;

export interface IdentityStore {
  resolveSession(tokenHash: string): Promise<SessionIdentity | null>;
  revokeSession(tokenHash: string): Promise<void>;
  getProfile(userId: string): Promise<unknown>;
  updateUsername(userId: string, username: string): Promise<unknown>;
  getTradeHistory(
    userId: string,
    input: Readonly<{ limit: number; before?: Date | undefined }>,
  ): Promise<unknown>;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class IdentityService {
  public constructor(private readonly store: IdentityStore) {}

  public async authenticate(sessionToken: string): Promise<SessionIdentity> {
    const token = sessionTokenSchema.safeParse(sessionToken);
    if (!token.success) throw new Error("UNAUTHENTICATED");
    const identity = await this.store.resolveSession(hash(token.data));
    if (!identity) throw new Error("UNAUTHENTICATED");
    return identity;
  }

  public async logout(sessionToken: string): Promise<void> {
    const token = sessionTokenSchema.safeParse(sessionToken);
    if (!token.success) throw new Error("UNAUTHENTICATED");
    await this.store.revokeSession(hash(token.data));
  }

  public getProfile(userId: string): Promise<unknown> {
    return this.store.getProfile(userId);
  }

  public updateUsername(
    userId: string,
    usernameInput: string,
  ): Promise<unknown> {
    return this.store.updateUsername(
      userId,
      usernameSchema.parse(usernameInput),
    );
  }

  public getTradeHistory(
    userId: string,
    input: Readonly<{
      limit?: number | undefined;
      before?: string | undefined;
    }>,
  ): Promise<unknown> {
    const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
    const before = input.before
      ? z.coerce.date().parse(input.before)
      : undefined;
    return this.store.getTradeHistory(userId, { limit, before });
  }
}

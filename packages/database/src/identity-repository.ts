import type { DatabaseClient } from "./index.js";
import { validateUsername } from "./identity-validation.js";
import { z } from "zod";

const userProfileRowSchema = z.object({
  id: z.string().uuid(),
  username: z.string().nullable(),
  status: z.enum(["active", "suspended", "deleted"]),
  login_count: z.coerce.number().int().nonnegative(),
  first_login_at: z.string().nullable(),
  last_login_at: z.string().nullable(),
  user_wallets: z.array(
    z.object({
      id: z.string().uuid(),
      wallet_address: z.string(),
      is_primary: z.boolean(),
      verified_at: z.string(),
    }),
  ),
});

const usernameRowSchema = z.object({ username: z.string() });

const tradeHistoryRowsSchema = z.array(
  z.object({
    id: z.string().uuid(),
    client_request_id: z.string().uuid(),
    chain_id: z.coerce.number().int().positive(),
    transaction_hash: z.string().nullable(),
    action: z.enum(["swap", "add_liquidity", "remove_liquidity", "claim_fees"]),
    status: z.enum([
      "submitted",
      "confirmed",
      "reverted",
      "replaced",
      "dropped",
    ]),
    venue: z.string(),
    token_in_address: z.string().nullable(),
    token_out_address: z.string().nullable(),
    amount_in_raw: z.string().nullable(),
    amount_out_raw: z.string().nullable(),
    fee_raw: z.string().nullable(),
    block_number: z.coerce.number().int().nonnegative().nullable(),
    block_timestamp: z.string().nullable(),
    submitted_at: z.string(),
    confirmed_at: z.string().nullable(),
  }),
);

export type UserWallet = Readonly<{
  id: string;
  walletAddress: string;
  isPrimary: boolean;
  verifiedAt: string;
}>;

export type UserProfile = Readonly<{
  id: string;
  username: string | null;
  status: "active" | "suspended" | "deleted";
  loginCount: number;
  firstLoginAt: string | null;
  lastLoginAt: string | null;
  wallets: readonly UserWallet[];
}>;

export type TradeHistoryItem = Readonly<{
  id: string;
  clientRequestId: string;
  chainId: number;
  transactionHash: string | null;
  action: "swap" | "add_liquidity" | "remove_liquidity" | "claim_fees";
  status: "submitted" | "confirmed" | "reverted" | "replaced" | "dropped";
  venue: string;
  tokenInAddress: string | null;
  tokenOutAddress: string | null;
  amountInRaw: string | null;
  amountOutRaw: string | null;
  feeRaw: string | null;
  blockNumber: number | null;
  blockTimestamp: string | null;
  submittedAt: string;
  confirmedAt: string | null;
}>;

export class IdentityRepository {
  public constructor(private readonly database: DatabaseClient) {}

  public async getUserProfile(userId: string): Promise<UserProfile | null> {
    const { data, error } = await this.database
      .from("users")
      .select(
        "id, username, status, login_count, first_login_at, last_login_at, user_wallets(id, wallet_address, is_primary, verified_at)",
      )
      .eq("id", userId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    const row = userProfileRowSchema.parse(data);

    return {
      id: row.id,
      username: row.username,
      status: row.status,
      loginCount: row.login_count,
      firstLoginAt: row.first_login_at,
      lastLoginAt: row.last_login_at,
      wallets: row.user_wallets.map((wallet) => ({
        id: wallet.id,
        walletAddress: wallet.wallet_address,
        isPrimary: wallet.is_primary,
        verifiedAt: wallet.verified_at,
      })),
    };
  }

  public async claimUsername(
    userId: string,
    username: string,
  ): Promise<string> {
    const normalizedUsername = validateUsername(username);
    const { data, error } = await this.database
      .from("users")
      .update({ username: normalizedUsername })
      .eq("id", userId)
      .eq("status", "active")
      .select("username")
      .single();

    if (error) throw error;
    return usernameRowSchema.parse(data).username;
  }

  public async listTradeHistory(
    userId: string,
    input: Readonly<{ limit?: number; before?: string }> = {},
  ): Promise<readonly TradeHistoryItem[]> {
    const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
    let query = this.database
      .from("trade_history")
      .select(
        "id, client_request_id, chain_id, transaction_hash, action, status, venue, token_in_address, token_out_address, amount_in_raw, amount_out_raw, fee_raw, block_number, block_timestamp, submitted_at, confirmed_at",
      )
      .eq("user_id", userId)
      .order("submitted_at", { ascending: false })
      .limit(limit);

    if (input.before) {
      query = query.lt("submitted_at", input.before);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = tradeHistoryRowsSchema.parse(data ?? []);

    return rows.map((trade) => ({
      id: trade.id,
      clientRequestId: trade.client_request_id,
      chainId: trade.chain_id,
      transactionHash: trade.transaction_hash,
      action: trade.action,
      status: trade.status,
      venue: trade.venue,
      tokenInAddress: trade.token_in_address,
      tokenOutAddress: trade.token_out_address,
      amountInRaw: trade.amount_in_raw,
      amountOutRaw: trade.amount_out_raw,
      feeRaw: trade.fee_raw,
      blockNumber: trade.block_number,
      blockTimestamp: trade.block_timestamp,
      submittedAt: trade.submitted_at,
      confirmedAt: trade.confirmed_at,
    }));
  }
}

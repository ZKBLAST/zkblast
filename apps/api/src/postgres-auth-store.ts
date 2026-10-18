import postgres, { type Sql } from "postgres";
import { z } from "zod";
import type { AuthStore, LoginChallenge } from "./auth-service.js";
import type { IdentityStore, SessionIdentity } from "./identity-service.js";
import type {
  ConfirmedTrade,
  TradeHistoryWriter,
} from "./trade-receipt-service.js";

const loginResultSchema = z
  .array(
    z.object({
      user_id: z.string().uuid(),
      wallet_id: z.string().uuid(),
    }),
  )
  .length(1);

const sessionResultSchema = z.array(
  z.object({ user_id: z.string().uuid(), wallet_id: z.string().uuid() }),
);

const profileResultSchema = z
  .array(
    z.object({
      id: z.string().uuid(),
      username: z.string().nullable(),
      status: z.enum(["active", "suspended", "deleted"]),
      login_count: z.coerce.number().int().nonnegative(),
      first_login_at: z.coerce.date().nullable(),
      last_login_at: z.coerce.date().nullable(),
    }),
  )
  .length(1);

const walletRowsSchema = z.array(
  z.object({
    id: z.string().uuid(),
    wallet_address: z.string(),
    is_primary: z.boolean(),
    verified_at: z.coerce.date(),
  }),
);

const usernameResultSchema = z
  .array(z.object({ username: z.string() }))
  .length(1);

const tradeRowsSchema = z.array(
  z.object({
    id: z.string().uuid(),
    client_request_id: z.string().uuid(),
    chain_id: z.coerce.number().int().positive(),
    transaction_hash: z.string().nullable(),
    action: z.string(),
    status: z.string(),
    venue: z.string(),
    token_in_address: z.string().nullable(),
    token_out_address: z.string().nullable(),
    amount_in_raw: z.string().nullable(),
    amount_out_raw: z.string().nullable(),
    fee_raw: z.string().nullable(),
    gas_used: z.string().nullable(),
    effective_gas_price_wei: z.string().nullable(),
    block_number: z.coerce.number().int().nonnegative().nullable(),
    block_timestamp: z.coerce.date().nullable(),
    submitted_at: z.coerce.date(),
    confirmed_at: z.coerce.date().nullable(),
  }),
);

export class PostgresAuthStore
  implements AuthStore, IdentityStore, TradeHistoryWriter
{
  private readonly sql: Sql;

  public constructor(
    databaseUrl: string,
    private readonly schema: string,
  ) {
    if (!/^zkblast_(testnet|mainnet)$/u.test(schema)) {
      throw new Error("INVALID_DATABASE_SCHEMA");
    }
    this.sql = postgres(databaseUrl, {
      max: 5,
      prepare: false,
      ssl: "require",
      connect_timeout: 15,
      idle_timeout: 20,
    });
  }

  public async createChallenge(challenge: LoginChallenge): Promise<void> {
    const uri = challenge.message.match(/^URI: (.+)$/mu)?.[1] ?? "";
    const chainId = Number(
      challenge.message.match(/^Chain ID: (\d+)$/mu)?.[1] ?? "0",
    );
    const domain = new URL(uri).host;

    await this.sql.unsafe(
      `insert into ${this.schema}.wallet_login_challenges (
        id, wallet_address, nonce_hash, message_hash, domain, uri, chain_id, expires_at
      ) values ($1, $2, decode($3, 'hex'), decode($4, 'hex'), $5, $6, $7, $8)`,
      [
        challenge.id,
        challenge.walletAddress,
        challenge.nonceHash,
        challenge.messageHash,
        domain,
        uri,
        chainId,
        challenge.expiresAt,
      ],
    );
  }

  public async consumeChallenge(input: {
    challengeId: string;
    walletAddress: string;
    nonceHash: string;
    messageHash: string;
    sessionTokenHash: string;
    sessionExpiresAt: Date;
  }): Promise<Readonly<{ userId: string; walletId: string }>> {
    let result: unknown;
    try {
      result = await this.sql.unsafe(
        `select * from ${this.schema}.complete_wallet_login($1, $2, $3, $4, $5, $6)`,
        [
          input.challengeId,
          input.walletAddress,
          input.nonceHash,
          input.messageHash,
          input.sessionTokenHash,
          input.sessionExpiresAt,
        ],
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("INVALID_OR_EXPIRED_CHALLENGE")
      ) {
        throw new Error("INVALID_OR_EXPIRED_CHALLENGE");
      }
      throw error;
    }

    const [identity] = loginResultSchema.parse(result);
    if (!identity) throw new Error("LOGIN_RESULT_MISSING");
    return { userId: identity.user_id, walletId: identity.wallet_id };
  }

  public async resolveSession(
    tokenHash: string,
  ): Promise<SessionIdentity | null> {
    const rows = sessionResultSchema.parse(
      await this.sql.unsafe(
        `update ${this.schema}.user_sessions s
         set last_seen_at = now()
         from ${this.schema}.users u
         where s.user_id = u.id
           and s.token_hash = decode($1, 'hex')
           and s.expires_at > now()
           and s.revoked_at is null
           and u.status = 'active'
         returning s.user_id, s.wallet_id`,
        [tokenHash],
      ),
    );
    const identity = rows[0];
    return identity
      ? { userId: identity.user_id, walletId: identity.wallet_id }
      : null;
  }

  public async revokeSession(tokenHash: string): Promise<void> {
    await this.sql.unsafe(
      `update ${this.schema}.user_sessions
       set revoked_at = coalesce(revoked_at, now())
       where token_hash = decode($1, 'hex')`,
      [tokenHash],
    );
  }

  public async getProfile(userId: string): Promise<unknown> {
    const [profile] = profileResultSchema.parse(
      await this.sql.unsafe(
        `select id, username, status, login_count, first_login_at, last_login_at
         from ${this.schema}.users where id = $1`,
        [userId],
      ),
    );
    if (!profile) throw new Error("USER_NOT_FOUND");
    const wallets = walletRowsSchema.parse(
      await this.sql.unsafe(
        `select id, wallet_address, is_primary, verified_at
         from ${this.schema}.user_wallets
         where user_id = $1 order by is_primary desc, created_at asc`,
        [userId],
      ),
    );
    return {
      id: profile.id,
      username: profile.username,
      status: profile.status,
      loginCount: profile.login_count,
      firstLoginAt: profile.first_login_at?.toISOString() ?? null,
      lastLoginAt: profile.last_login_at?.toISOString() ?? null,
      wallets: wallets.map((wallet) => ({
        id: wallet.id,
        address: wallet.wallet_address,
        isPrimary: wallet.is_primary,
        verifiedAt: wallet.verified_at.toISOString(),
      })),
    };
  }

  public async updateUsername(
    userId: string,
    username: string,
  ): Promise<unknown> {
    try {
      const [result] = usernameResultSchema.parse(
        await this.sql.unsafe(
          `update ${this.schema}.users set username = $2
           where id = $1 and status = 'active' returning username`,
          [userId, username],
        ),
      );
      if (!result) throw new Error("USER_NOT_FOUND");
      return { username: result.username };
    } catch (error) {
      if (error instanceof postgres.PostgresError && error.code === "23505") {
        throw new Error("USERNAME_TAKEN");
      }
      throw error;
    }
  }

  public async getTradeHistory(
    userId: string,
    input: Readonly<{ limit: number; before?: Date | undefined }>,
  ): Promise<unknown> {
    const before = input.before ?? new Date("9999-12-31T23:59:59.999Z");
    const rows = tradeRowsSchema.parse(
      await this.sql.unsafe(
        `select id, client_request_id, chain_id, transaction_hash, action, status,
                venue, token_in_address, token_out_address, amount_in_raw,
                amount_out_raw, fee_raw, gas_used, effective_gas_price_wei,
                block_number, block_timestamp,
                submitted_at, confirmed_at
         from ${this.schema}.trade_history
         where user_id = $1 and submitted_at < $2
         order by submitted_at desc limit $3`,
        [userId, before, input.limit],
      ),
    );
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
      gasUsed: trade.gas_used,
      effectiveGasPriceWei: trade.effective_gas_price_wei,
      blockNumber: trade.block_number,
      blockTimestamp: trade.block_timestamp?.toISOString() ?? null,
      submittedAt: trade.submitted_at.toISOString(),
      confirmedAt: trade.confirmed_at?.toISOString() ?? null,
    }));
  }

  public async walletAddress(walletId: string): Promise<string> {
    const rows = await this.sql.unsafe<{ wallet_address: string }[]>(
      `select wallet_address from ${this.schema}.user_wallets where id=$1`,
      [walletId],
    );
    if (rows.length !== 1) throw new Error("WALLET_NOT_FOUND");
    return rows[0]!.wallet_address;
  }

  public async saveConfirmedTrade(
    userId: string,
    walletId: string,
    trade: ConfirmedTrade,
  ): Promise<unknown> {
    const rows = await this.sql.unsafe<{ id: string }[]>(
      `insert into ${this.schema}.trade_history
        (user_id,wallet_id,client_request_id,chain_id,transaction_hash,log_index,
         action,status,venue,pool_address,token_in_address,token_out_address,
         amount_in_raw,amount_out_raw,fee_raw,gas_used,effective_gas_price_wei,
         block_number,block_timestamp,submitted_at,confirmed_at)
       values ($1,$2,$3,$4,$5,$6,'swap','confirmed',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now(),now())
       on conflict (client_request_id) do update set
         transaction_hash=excluded.transaction_hash,log_index=excluded.log_index,
         status='confirmed',amount_out_raw=excluded.amount_out_raw,
         fee_raw=excluded.fee_raw,gas_used=excluded.gas_used,
         effective_gas_price_wei=excluded.effective_gas_price_wei,
         block_number=excluded.block_number,
         block_timestamp=excluded.block_timestamp,confirmed_at=excluded.confirmed_at
       where ${this.schema}.trade_history.user_id=excluded.user_id
         and ${this.schema}.trade_history.wallet_id=excluded.wallet_id
       returning id`,
      [
        userId,
        walletId,
        trade.clientRequestId,
        trade.chainId,
        trade.transactionHash,
        trade.logIndex,
        trade.venue,
        trade.poolAddress,
        trade.tokenInAddress,
        trade.tokenOutAddress,
        trade.amountInRaw,
        trade.amountOutRaw,
        trade.feeRaw,
        trade.gasUsed,
        trade.effectiveGasPriceWei,
        trade.blockNumber,
        trade.blockTimestamp,
      ],
    );
    if (rows.length !== 1) throw new Error("TRADE_OWNERSHIP_CONFLICT");
    return { id: rows[0]!.id, status: "confirmed" };
  }
}

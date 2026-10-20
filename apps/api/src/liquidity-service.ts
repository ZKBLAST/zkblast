import {
  dammPoolAbi,
  dlmmPoolAbi,
  erc20Abi,
  positionManagerAbi,
} from "@zkblast/abi";
import {
  buildApproval,
  buildCreateDammPosition,
  buildCreateDlmmPosition,
  buildDammFeeClaim,
  buildDecreasePosition,
  buildDlmmFeeClaim,
  buildIncreasePosition,
  buildTransferPosition,
  normalizeTransactionError,
  type ContractReader,
  type ProtocolAddresses,
} from "@zkblast/sdk";
import { getAddress, type Address } from "viem";
import { encodeTransaction } from "./transaction-encoder.js";

type Position = readonly [Address, Address, number, number, bigint];
type BasePositionInput = Readonly<{
  owner: string;
  positionId: string;
}>;

export class LiquidityService {
  constructor(
    private readonly client: ContractReader,
    private readonly addresses: ProtocolAddresses,
    private readonly chainId: number,
    private readonly isRegisteredPool: (pool: Address) => Promise<boolean>,
  ) {}

  async prepareCreate(
    input: Readonly<{
      model: "damm" | "dlmm";
      pool: string;
      token0: string;
      token1: string;
      amount0: string;
      amount1: string;
      minimumShares: string;
      deadline: string;
      binId?: number | undefined;
    }>,
  ) {
    return this.normalize(async () => {
      const pool = getAddress(input.pool);
      if (!(await this.isRegisteredPool(pool)))
        throw new Error("UNREGISTERED_POOL");
      const amount0 = this.positive(input.amount0);
      const amount1 = this.positive(input.amount1);
      const deadline = this.positive(input.deadline);
      const token0 = getAddress(input.token0);
      const token1 = getAddress(input.token1);
      await this.assertPoolTokens(pool, input.model, token0, token1);
      let binId = input.binId;
      if (input.model === "dlmm") {
        if (binId === undefined) {
          const active = await this.client.readContract({
            address: pool,
            abi: dlmmPoolAbi,
            functionName: "activeBin",
          });
          if (typeof active !== "number" || !Number.isInteger(active))
            throw new Error("INVALID_ACTIVE_BIN");
          binId = active;
        }
        if (!Number.isInteger(binId) || binId < -10_000 || binId > 10_000)
          throw new Error("INVALID_BIN");
      }
      const base = {
        manager: this.addresses.positionManager,
        pool,
        amount0,
        amount1,
        minimumShares: this.unsigned(input.minimumShares),
        deadline,
      };
      const position =
        input.model === "damm"
          ? buildCreateDammPosition(base)
          : buildCreateDlmmPosition({ ...base, binId: binId! });
      return {
        chainId: this.chainId,
        ...(input.model === "dlmm" ? { binId } : {}),
        approvals: [
          encodeTransaction(
            buildApproval(token0, this.addresses.positionManager, amount0),
          ),
          encodeTransaction(
            buildApproval(token1, this.addresses.positionManager, amount1),
          ),
        ],
        position: encodeTransaction(position),
      };
    });
  }

  async dlmmBins(poolInput: string) {
    return this.normalize(async () => {
      const pool = getAddress(poolInput);
      if (!(await this.isRegisteredPool(pool)))
        throw new Error("UNREGISTERED_POOL");
      const model = await this.client.readContract({
        address: pool,
        abi: dlmmPoolAbi,
        functionName: "model",
      });
      if (Number(model) !== 1) throw new Error("INVALID_POOL_MODEL");
      const active = await this.client.readContract({
        address: pool,
        abi: dlmmPoolAbi,
        functionName: "activeBin",
      });
      if (
        typeof active !== "number" ||
        !Number.isInteger(active) ||
        active < -10_000 ||
        active > 10_000
      )
        throw new Error("INVALID_ACTIVE_BIN");
      const step = await this.client.readContract({
        address: pool,
        abi: dlmmPoolAbi,
        functionName: "binStepBps",
      });
      const minimumLockedLiquidity = await this.client.readContract({
        address: pool,
        abi: dlmmPoolAbi,
        functionName: "MINIMUM_BIN_LIQUIDITY",
      });
      const start = Math.max(-10_000, active - 8);
      const end = Math.min(10_000, active + 8);
      const bins = await Promise.all(
        Array.from({ length: end - start + 1 }, async (_, index) => {
          const binId = start + index;
          const state = await this.client.readContract({
            address: pool,
            abi: dlmmPoolAbi,
            functionName: "binState",
            args: [binId],
          });
          if (
            !Array.isArray(state) ||
            state.length !== 4 ||
            state.some((value) => typeof value !== "bigint" || value < 0n)
          )
            throw new Error("INVALID_BIN_STATE");
          return {
            binId,
            reserve0: String(state[0]),
            reserve1: String(state[1]),
            totalShares: String(state[2]),
            priceX18: String(state[3]),
          };
        }),
      );
      return {
        chainId: this.chainId,
        pool,
        activeBin: active,
        binStepBps: Number(step),
        minimumLockedLiquidity: String(minimumLockedLiquidity),
        bins,
      };
    });
  }

  async prepareIncrease(
    input: BasePositionInput &
      Readonly<{
        amount0: string;
        amount1: string;
        minimumShares: string;
        deadline: string;
      }>,
  ) {
    return this.normalize(async () => {
      const positionId = this.positive(input.positionId);
      const position = await this.ownedPosition(positionId, input.owner);
      const amount0 = this.positive(input.amount0);
      const amount1 = this.positive(input.amount1);
      const [token0, token1] = await this.poolTokens(position[1], position[2]);
      return {
        chainId: this.chainId,
        approvals: [
          encodeTransaction(
            buildApproval(token0, this.addresses.positionManager, amount0),
          ),
          encodeTransaction(
            buildApproval(token1, this.addresses.positionManager, amount1),
          ),
        ],
        position: encodeTransaction(
          buildIncreasePosition(
            this.addresses.positionManager,
            positionId,
            amount0,
            amount1,
            this.unsigned(input.minimumShares),
            this.positive(input.deadline),
          ),
        ),
      };
    });
  }

  async prepareDecrease(
    input: BasePositionInput &
      Readonly<{
        shares: string;
        minimumAmount0: string;
        minimumAmount1: string;
        recipient: string;
        deadline: string;
      }>,
  ) {
    return this.normalize(async () => {
      const positionId = this.positive(input.positionId);
      const position = await this.ownedPosition(positionId, input.owner);
      const shares = this.positive(input.shares);
      if (shares > position[4]) throw new Error("INSUFFICIENT_POSITION_SHARES");
      // DLMM liquidity belongs to the position's bin, not global DAMM reserves.
      const accounting =
        position[2] === 1
          ? await this.client.readContract({
              address: position[1],
              abi: dlmmPoolAbi,
              functionName: "binState",
              args: [position[3]],
            })
          : await Promise.all(
              ["reserve0", "reserve1", "totalShares"].map((functionName) =>
                this.client.readContract({
                  address: position[1],
                  abi: dammPoolAbi,
                  functionName,
                }),
              ),
            );
      if (!Array.isArray(accounting))
        throw new Error("INVALID_POOL_ACCOUNTING");
      const [reserve0Value, reserve1Value, totalSharesValue] = accounting as unknown[];
      if (
        typeof reserve0Value !== "bigint" ||
        typeof reserve1Value !== "bigint" ||
        typeof totalSharesValue !== "bigint" ||
        reserve0Value < 0n ||
        reserve1Value < 0n ||
        totalSharesValue <= 0n
      )
        throw new Error("INVALID_POOL_ACCOUNTING");
      const safeMinimum0 =
        (((shares * reserve0Value) / totalSharesValue) * 99n) / 100n;
      const safeMinimum1 =
        (((shares * reserve1Value) / totalSharesValue) * 99n) / 100n;
      const requestedMinimum0 = this.unsigned(input.minimumAmount0);
      const requestedMinimum1 = this.unsigned(input.minimumAmount1);
      return {
        chainId: this.chainId,
        minimumAmount0: (requestedMinimum0 > safeMinimum0
          ? requestedMinimum0
          : safeMinimum0
        ).toString(),
        minimumAmount1: (requestedMinimum1 > safeMinimum1
          ? requestedMinimum1
          : safeMinimum1
        ).toString(),
        position: encodeTransaction(
          buildDecreasePosition(
            this.addresses.positionManager,
            positionId,
            shares,
            requestedMinimum0 > safeMinimum0 ? requestedMinimum0 : safeMinimum0,
            requestedMinimum1 > safeMinimum1 ? requestedMinimum1 : safeMinimum1,
            getAddress(input.recipient),
            this.positive(input.deadline),
          ),
        ),
      };
    });
  }

  async prepareTransfer(
    input: BasePositionInput & Readonly<{ nextOwner: string }>,
  ) {
    return this.normalize(async () => {
      const positionId = this.positive(input.positionId);
      await this.ownedPosition(positionId, input.owner);
      return {
        chainId: this.chainId,
        position: encodeTransaction(
          buildTransferPosition(
            this.addresses.positionManager,
            positionId,
            getAddress(input.nextOwner),
          ),
        ),
      };
    });
  }

  async prepareFeeClaim(
    input: Readonly<{ model: "damm" | "dlmm"; pool: string; wallet: string }>,
  ) {
    return this.normalize(async () => {
      const pool = getAddress(input.pool);
      if (!(await this.isRegisteredPool(pool)))
        throw new Error("UNREGISTERED_POOL");
      const abi = input.model === "damm" ? dammPoolAbi : dlmmPoolAbi;
      const recipient = await this.client.readContract({
        address: pool,
        abi,
        functionName: "protocolFeeRecipient",
      });
      if (typeof recipient !== "string")
        throw new Error("INVALID_FEE_RECIPIENT");
      const eligible = getAddress(recipient) === getAddress(input.wallet);
      return {
        chainId: this.chainId,
        eligible,
        recipient: getAddress(recipient),
        claim: eligible
          ? encodeTransaction(
              input.model === "damm"
                ? buildDammFeeClaim(pool)
                : buildDlmmFeeClaim(pool),
            )
          : null,
      };
    });
  }

  async positionsForOwner(ownerInput: string) {
    return this.normalize(async () => {
      const owner = getAddress(ownerInput);
      const nextPositionId = await this.client.readContract({
        address: this.addresses.positionManager,
        abi: positionManagerAbi,
        functionName: "nextPositionId",
      });
      if (typeof nextPositionId !== "bigint" || nextPositionId > 5_001n)
        throw new Error("POSITION_SCAN_LIMIT_EXCEEDED");
      const positionIds = Array.from(
        { length: Number(nextPositionId > 0n ? nextPositionId - 1n : 0n) },
        (_, index) => BigInt(index + 1),
      );
      const positions = await Promise.all(
        positionIds.map(async (positionId) => ({
          positionId,
          value: await this.position(positionId),
        })),
      );
      const owned = positions.filter(
        ({ value }) => getAddress(value[0]) === owner && value[4] > 0n,
      );
      return Promise.all(
        owned.map(async ({ positionId, value }) => {
          const [token0, token1] = await this.poolTokens(value[1], value[2]);
          const [token0Symbol, token0Decimals, token1Symbol, token1Decimals] =
            await Promise.all([
              this.client.readContract({
                address: token0,
                abi: erc20Abi,
                functionName: "symbol",
              }),
              this.client.readContract({
                address: token0,
                abi: erc20Abi,
                functionName: "decimals",
              }),
              this.client.readContract({
                address: token1,
                abi: erc20Abi,
                functionName: "symbol",
              }),
              this.client.readContract({
                address: token1,
                abi: erc20Abi,
                functionName: "decimals",
              }),
            ]);
          if (
            typeof token0Symbol !== "string" ||
            typeof token1Symbol !== "string" ||
            typeof token0Decimals !== "number" ||
            typeof token1Decimals !== "number"
          )
            throw new Error("INVALID_POSITION_TOKEN_METADATA");
          return {
            onchainPositionId: positionId.toString(),
            liquidityRaw: value[4].toString(),
            lowerBound: value[2] === 1 ? value[3] : null,
            upperBound: value[2] === 1 ? value[3] : null,
            status: "open" as const,
            poolAddress: value[1],
            model: value[2] === 0 ? ("damm" as const) : ("dlmm" as const),
            token0Address: token0,
            token0Symbol,
            token0Decimals,
            token1Address: token1,
            token1Symbol,
            token1Decimals,
          };
        }),
      );
    });
  }

  async accounting(poolInput: string, walletInput?: string) {
    return this.normalize(async () => {
      const pool = getAddress(poolInput);
      if (!(await this.isRegisteredPool(pool)))
        throw new Error("UNREGISTERED_POOL");
      const wallet = walletInput ? getAddress(walletInput) : undefined;
      const fields = [
        "token0",
        "token1",
        "reserve0",
        "reserve1",
        "totalShares",
        "protocolFees0",
        "protocolFees1",
        "MINIMUM_LIQUIDITY",
      ] as const;
      const values = await Promise.all(
        fields.map((functionName) =>
          this.client.readContract({
            address: pool,
            abi: dammPoolAbi,
            functionName,
          }),
        ),
      );
      const [token0, token1] = values as [
        Address,
        Address,
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
      ];
      const [balance0, balance1, walletShares] = (await Promise.all([
        this.client.readContract({
          address: token0,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [pool],
        }),
        this.client.readContract({
          address: token1,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [pool],
        }),
        wallet
          ? this.client.readContract({
              address: pool,
              abi: dammPoolAbi,
              functionName: "sharesOf",
              args: [wallet],
            })
          : 0n,
      ])) as [bigint, bigint, bigint];
      const reserve0 = values[2] as bigint;
      const reserve1 = values[3] as bigint;
      const fee0 = values[5] as bigint;
      const fee1 = values[6] as bigint;
      return {
        chainId: this.chainId,
        pool,
        token0,
        token1,
        reserve0: reserve0.toString(),
        reserve1: reserve1.toString(),
        totalShares: (values[4] as bigint).toString(),
        minimumLockedLiquidity: String(values[7]),
        protocolFees0: fee0.toString(),
        protocolFees1: fee1.toString(),
        tokenBalance0: balance0.toString(),
        tokenBalance1: balance1.toString(),
        walletShares: walletShares.toString(),
        reconciled:
          balance0 === reserve0 + fee0 && balance1 === reserve1 + fee1,
      };
    });
  }

  private positive(value: string) {
    const parsed = this.unsigned(value);
    if (parsed <= 0n) throw new Error("INVALID_LIQUIDITY_INPUT");
    return parsed;
  }

  private unsigned(value: string) {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error("INVALID_LIQUIDITY_INPUT");
    return parsed;
  }

  private async position(positionId: bigint): Promise<Position> {
    const value = await this.client.readContract({
      address: this.addresses.positionManager,
      abi: positionManagerAbi,
      functionName: "positions",
      args: [positionId],
    });
    if (!Array.isArray(value) || value.length !== 5)
      throw new Error("INVALID_POSITION");
    return value as unknown as Position;
  }

  private async ownedPosition(positionId: bigint, ownerInput: string) {
    const position = await this.position(positionId);
    if (getAddress(position[0]) !== getAddress(ownerInput))
      throw new Error("UNAUTHORIZED_POSITION");
    return position;
  }

  private async poolTokens(pool: Address, model: number) {
    const abi = model === 0 ? dammPoolAbi : dlmmPoolAbi;
    return Promise.all(
      ["token0", "token1"].map((functionName) =>
        this.client.readContract({
          address: pool,
          abi,
          functionName,
        }),
      ),
    ) as Promise<[Address, Address]>;
  }

  private async assertPoolTokens(
    pool: Address,
    model: "damm" | "dlmm",
    token0: Address,
    token1: Address,
  ) {
    const actual = await this.poolTokens(pool, model === "damm" ? 0 : 1);
    if (getAddress(actual[0]) !== token0 || getAddress(actual[1]) !== token1)
      throw new Error("POOL_TOKEN_MISMATCH");
  }

  private async normalize<T>(operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error) {
      throw normalizeTransactionError(error);
    }
  }
}

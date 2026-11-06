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

const dlmmLensAbi = [
  {
    type: "function",
    name: "getBins",
    stateMutability: "view",
    inputs: [
      { name: "pool", type: "address" },
      { name: "lower", type: "int24" },
      { name: "upper", type: "int24" },
      { name: "skipEmpty", type: "bool" },
    ],
    outputs: [
      { name: "activeBin", type: "int24" },
      {
        name: "bins",
        type: "tuple[]",
        components: [
          { name: "binId", type: "int24" },
          { name: "reserve0", type: "uint128" },
          { name: "reserve1", type: "uint128" },
          { name: "totalShares", type: "uint256" },
          { name: "priceX18", type: "uint256" },
        ],
      },
    ],
  },
] as const;

type Position = readonly [Address, Address, number, number, bigint];
type BasePositionInput = Readonly<{
  owner: string;
  positionId: string;
}>;

export class LiquidityService {
  private readonly binCache = new Map<string, unknown>();
  private readonly topLpCache = new Map<string, Readonly<{ expiresAt: number; value: unknown }>>();

  constructor(
    private readonly client: ContractReader,
    private readonly addresses: ProtocolAddresses,
    private readonly chainId: number,
    private readonly isRegisteredPool: (pool: Address) => Promise<boolean>,
    private readonly dlmmRead?: Readonly<{
      lens: Address;
      blockNumber: () => Promise<bigint>;
    }>,
    private readonly shieldedLiquidityOwners: readonly Address[] = [],
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

  async dlmmBins(
    poolInput: string,
    range?: Readonly<{
      lower?: number | undefined;
      upper?: number | undefined;
      skipEmpty?: boolean | undefined;
    }>,
  ) {
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
      const hasExplicitRange =
        range?.lower !== undefined || range?.upper !== undefined;
      if (hasExplicitRange && (range?.lower === undefined || range.upper === undefined))
        throw new Error("INVALID_BIN_RANGE");
      const radius = this.dlmmRead ? 60 : 8;
      const start = hasExplicitRange
        ? range!.lower!
        : Math.max(-10_000, active - radius);
      const end = hasExplicitRange
        ? range!.upper!
        : Math.min(10_000, active + radius);
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < -10_000 ||
        end > 10_000 ||
        start > end ||
        end - start + 1 > 121
      )
        throw new Error("INVALID_BIN_RANGE");
      const skipEmpty = range?.skipEmpty ?? false;
      const observedBlock = this.dlmmRead
        ? await this.dlmmRead.blockNumber()
        : undefined;
      const cacheKey = observedBlock !== undefined
        ? `${this.chainId}:${pool}:${observedBlock}:${start}:${end}:${skipEmpty}`
        : undefined;
      const cached = cacheKey ? this.binCache.get(cacheKey) : undefined;
      if (cached) return cached;

      const lensResult = this.dlmmRead
        ? await this.client.readContract({
            address: this.dlmmRead.lens,
            abi: dlmmLensAbi,
            functionName: "getBins",
            args: [pool, start, end, skipEmpty],
          })
        : undefined;
      if (
        lensResult !== undefined &&
        (!Array.isArray(lensResult) ||
          lensResult.length !== 2 ||
          typeof lensResult[0] !== "number" ||
          !Array.isArray(lensResult[1]))
      )
        throw new Error("INVALID_LENS_RESULT");
      const bins = lensResult
        ? lensResult[1].map((state: unknown) => {
            if (
              !Array.isArray(state) ||
              state.length !== 5 ||
              typeof state[0] !== "number" ||
              state.slice(1).some((value) => typeof value !== "bigint" || value < 0n)
            )
              throw new Error("INVALID_BIN_STATE");
            return {
              binId: state[0],
              reserve0: String(state[1]),
              reserve1: String(state[2]),
              totalShares: String(state[3]),
              priceX18: String(state[4]),
            };
          })
        : await Promise.all(
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
          const bin = {
            binId,
            reserve0: String(state[0]),
            reserve1: String(state[1]),
            totalShares: String(state[2]),
            priceX18: String(state[3]),
          };
          return skipEmpty && state[2] === 0n ? undefined : bin;
        }),
      ).then((items) => items.filter((item) => item !== undefined));
      const result = {
        chainId: this.chainId,
        pool,
        activeBin: lensResult ? lensResult[0] : active,
        binStepBps: Number(step),
        minimumLockedLiquidity: String(minimumLockedLiquidity),
        observedBlock: observedBlock?.toString() ?? null,
        range: { lower: start, upper: end, skipEmpty },
        source: lensResult ? "lens" : "pool",
        bins,
      };
      if (cacheKey) {
        if (this.binCache.size >= 128) {
          const oldest = this.binCache.keys().next().value as string | undefined;
          if (oldest) this.binCache.delete(oldest);
        }
        this.binCache.set(cacheKey, result);
      }
      return result;
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
          const [reserve0, reserve1, totalShares, priceX18] =
            value[2] === 0
              ? await this.dammPositionState(value[1], token0Decimals, token1Decimals)
              : await this.dlmmPositionState(value[1], value[3]);
          const currentAmount0Raw = value[4] * reserve0 / totalShares;
          const currentAmount1Raw = value[4] * reserve1 / totalShares;
          const currentValueToken1Raw = currentAmount1Raw +
            currentAmount0Raw * priceX18 * 10n ** BigInt(token1Decimals) /
              (10n ** 18n * 10n ** BigInt(token0Decimals));
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
            currentAmount0Raw: currentAmount0Raw.toString(),
            currentAmount1Raw: currentAmount1Raw.toString(),
            currentValueToken1Raw: currentValueToken1Raw.toString(),
            depositBasisToken1Raw: null,
            earningsToken1Raw: null,
            valuationCoverage: "current_onchain_value",
          };
        }),
      );
    });
  }

  async topLiquidityProviders(poolInput: string, limit = 10) {
    return this.normalize(async () => {
      const pool = getAddress(poolInput);
      const cacheKey = `${this.chainId}:${pool}:${limit}`;
      const cached = this.topLpCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.value;
      if (!(await this.isRegisteredPool(pool))) throw new Error("UNREGISTERED_POOL");
      const nextPositionId = await this.client.readContract({
        address: this.addresses.positionManager,
        abi: positionManagerAbi,
        functionName: "nextPositionId",
      });
      if (typeof nextPositionId !== "bigint" || nextPositionId > 5_001n)
        throw new Error("POSITION_SCAN_LIMIT_EXCEEDED");
      const positions = await Promise.all(
        Array.from(
          { length: Number(nextPositionId > 0n ? nextPositionId - 1n : 0n) },
          async (_, index) => {
            const positionId = BigInt(index + 1);
            return { positionId, value: await this.position(positionId) };
          },
        ),
      );
      const matching = positions.filter(
        ({ value }) => getAddress(value[1]) === pool && value[4] > 0n,
      );
      if (!matching.length) return { chainId: this.chainId, pool, coverage: "all_open_positions", items: [] };
      const model = matching[0]!.value[2];
      if (matching.some(({ value }) => value[2] !== model))
        throw new Error("POSITION_MODEL_MISMATCH");
      const [token0, token1] = await this.poolTokens(pool, model);
      const [decimals0, decimals1] = await Promise.all([
        this.client.readContract({ address: token0, abi: erc20Abi, functionName: "decimals" }),
        this.client.readContract({ address: token1, abi: erc20Abi, functionName: "decimals" }),
      ]);
      if (typeof decimals0 !== "number" || typeof decimals1 !== "number")
        throw new Error("INVALID_POSITION_TOKEN_METADATA");
      const dammState = model === 0
        ? await Promise.all(["reserve0", "reserve1", "totalShares"].map((functionName) =>
            this.client.readContract({ address: pool, abi: dammPoolAbi, functionName })))
        : null;
      const valued = await Promise.all(matching.map(async ({ positionId, value }) => {
        let reserve0: bigint;
        let reserve1: bigint;
        let totalShares: bigint;
        let priceX18: bigint;
        if (model === 0) {
          [reserve0, reserve1, totalShares] = dammState as [bigint, bigint, bigint];
          priceX18 = reserve0 > 0n
            ? reserve1 * 10n ** BigInt(decimals0) * 10n ** 18n /
              (reserve0 * 10n ** BigInt(decimals1))
            : 0n;
        } else {
          const state = await this.client.readContract({
            address: pool,
            abi: dlmmPoolAbi,
            functionName: "binState",
            args: [value[3]],
          });
          if (!Array.isArray(state) || state.length !== 4 || state.some((item) => typeof item !== "bigint"))
            throw new Error("INVALID_BIN_STATE");
          [reserve0, reserve1, totalShares, priceX18] = state as [bigint, bigint, bigint, bigint];
        }
        if (totalShares <= 0n) throw new Error("INVALID_POSITION_SHARES");
        const amount0 = value[4] * reserve0 / totalShares;
        const amount1 = value[4] * reserve1 / totalShares;
        const value1Raw = amount1 + amount0 * priceX18 * 10n ** BigInt(decimals1) /
          (10n ** 18n * 10n ** BigInt(decimals0));
        return { positionId, owner: getAddress(value[0]), binId: model === 1 ? value[3] : null, amount0, amount1, value1Raw };
      }));
      const shielded = new Set(this.shieldedLiquidityOwners.map((owner) => getAddress(owner)));
      const grouped = new Map<Address, {
        amount0: bigint;
        amount1: bigint;
        value1Raw: bigint;
        positionIds: string[];
        bins: number[];
      }>();
      for (const position of valued) {
        const current = grouped.get(position.owner) ?? { amount0: 0n, amount1: 0n, value1Raw: 0n, positionIds: [], bins: [] };
        current.amount0 += position.amount0;
        current.amount1 += position.amount1;
        current.value1Raw += position.value1Raw;
        current.positionIds.push(position.positionId.toString());
        if (position.binId !== null) current.bins.push(position.binId);
        grouped.set(position.owner, current);
      }
      const totalValue1Raw = [...grouped.values()].reduce((sum, item) => sum + item.value1Raw, 0n);
      const items = [...grouped.entries()]
        .sort((left, right) => left[1].value1Raw === right[1].value1Raw ? 0 : left[1].value1Raw > right[1].value1Raw ? -1 : 1)
        .slice(0, limit)
        .map(([owner, item], index) => ({
          rank: index + 1,
          owner: shielded.has(owner) ? null : owner,
          label: shielded.has(owner) ? "Shielded Vault" : null,
          privacy: shielded.has(owner) ? "shielded_aggregate" : "public",
          amount0Raw: item.amount0.toString(),
          amount1Raw: item.amount1.toString(),
          currentValueToken1Raw: item.value1Raw.toString(),
          poolShareBps: totalValue1Raw > 0n ? (item.value1Raw * 10_000n / totalValue1Raw).toString() : "0",
          positionCount: item.positionIds.length,
          bins: [...new Set(item.bins)].sort((left, right) => left - right),
        }));
      const result = {
        chainId: this.chainId,
        pool,
        model: model === 0 ? "damm" : "dlmm",
        token0,
        token1,
        token0Decimals: decimals0,
        token1Decimals: decimals1,
        totalValueToken1Raw: totalValue1Raw.toString(),
        coverage: "all_open_positions",
        items,
      };
      if (this.topLpCache.size >= 32) {
        const oldest = this.topLpCache.keys().next().value as string | undefined;
        if (oldest) this.topLpCache.delete(oldest);
      }
      this.topLpCache.set(cacheKey, { expiresAt: Date.now() + 10_000, value: result });
      return result;
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

  private async dammPositionState(
    pool: Address,
    decimals0: number,
    decimals1: number,
  ): Promise<[bigint, bigint, bigint, bigint]> {
    const [reserve0, reserve1, totalShares] = await Promise.all(
      ["reserve0", "reserve1", "totalShares"].map((functionName) =>
        this.client.readContract({ address: pool, abi: dammPoolAbi, functionName })),
    ) as [bigint, bigint, bigint];
    if (reserve0 < 0n || reserve1 < 0n || totalShares <= 0n)
      throw new Error("INVALID_POOL_ACCOUNTING");
    const priceX18 = reserve0 > 0n
      ? reserve1 * 10n ** BigInt(decimals0) * 10n ** 18n /
        (reserve0 * 10n ** BigInt(decimals1))
      : 0n;
    return [reserve0, reserve1, totalShares, priceX18];
  }

  private async dlmmPositionState(
    pool: Address,
    binId: number,
  ): Promise<[bigint, bigint, bigint, bigint]> {
    const state = await this.client.readContract({
      address: pool,
      abi: dlmmPoolAbi,
      functionName: "binState",
      args: [binId],
    });
    if (
      !Array.isArray(state) ||
      state.length !== 4 ||
      state.some((item) => typeof item !== "bigint" || item < 0n) ||
      state[2] <= 0n
    ) throw new Error("INVALID_BIN_STATE");
    return state as [bigint, bigint, bigint, bigint];
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

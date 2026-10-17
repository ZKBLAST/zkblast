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
          : buildCreateDlmmPosition({ ...base, binId: input.binId ?? 0 });
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
        position: encodeTransaction(position),
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
      return {
        chainId: this.chainId,
        position: encodeTransaction(
          buildDecreasePosition(
            this.addresses.positionManager,
            positionId,
            shares,
            this.unsigned(input.minimumAmount0),
            this.unsigned(input.minimumAmount1),
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

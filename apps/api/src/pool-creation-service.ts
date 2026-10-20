import { poolFactoryAbi, poolRegistryAbi, erc20Abi } from "@zkblast/abi";
import { initialBinForPrice } from "@zkblast/sdk";
import { encodeAbiParameters, encodeFunctionData, formatUnits, getAddress, keccak256, zeroAddress, zeroHash, type Address, type PublicClient } from "viem";
import { z } from "zod";

export const poolCreationSchema = z.object({
  tokenA: z.string().regex(/^0x[\da-f]{40}$/iu), tokenB: z.string().regex(/^0x[\da-f]{40}$/iu),
  model: z.enum(["damm", "dlmm"]), feePips: z.number().int().min(1).max(999999),
  binStepBps: z.number().int().min(0).max(1000), initialPrice: z.string().optional(),
  wallet: z.string().regex(/^0x[\da-f]{40}$/iu),
}).strict().superRefine((input, context) => {
  if (input.tokenA.toLowerCase() === input.tokenB.toLowerCase() || [input.tokenA, input.tokenB].some((a) => a.toLowerCase() === zeroAddress) ||
      (input.model === "damm" && input.binStepBps !== 0) ||
      (input.model === "dlmm" && (!input.initialPrice || input.binStepBps < 1)))
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid pool parameters" });
});

export class PoolCreationService {
  constructor(private readonly client: Pick<PublicClient, "readContract" | "simulateContract">,
    private readonly factory: Address, private readonly registry: Address, private readonly chainId: number) {}

  async prepare(raw: unknown) {
    const input = poolCreationSchema.parse(raw);
    const tokenA = getAddress(input.tokenA), tokenB = getAddress(input.tokenB), wallet = getAddress(input.wallet);
    const aIsToken0 = BigInt(tokenA) < BigInt(tokenB);
    const token0 = aIsToken0 ? tokenA : tokenB, token1 = aIsToken0 ? tokenB : tokenA;
    const metadata = async (address: Address) => {
      const [symbol, decimals] = await Promise.all([
        this.client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
        this.client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
      ]);
      return { address, symbol: z.string().min(1).max(64).parse(symbol), decimals: z.number().int().min(0).max(36).parse(decimals) };
    };
    const [asset0, asset1, authorized] = await Promise.all([metadata(token0), metadata(token1),
      this.client.readContract({ address: this.factory, abi: poolFactoryAbi, functionName: "hasRole", args: [zeroHash, wallet] })]);
    const initial = input.model === "dlmm" ? initialBinForPrice(input.initialPrice!, asset0.decimals, asset1.decimals, aIsToken0, input.binStepBps) : null;
    const key = { token0, token1, model: input.model === "damm" ? 0 : 1, feePips: input.feePips, binStepBps: input.binStepBps };
    const poolId = keccak256(encodeAbiParameters([{ type: "tuple", components: [
      { name: "token0", type: "address" }, { name: "token1", type: "address" }, { name: "model", type: "uint8" },
      { name: "feePips", type: "uint24" }, { name: "binStepBps", type: "uint16" },
    ] }], [key]));
    const existing = await this.client.readContract({ address: this.registry, abi: poolRegistryAbi, functionName: "poolById", args: [poolId] });
    const args = input.model === "damm" ? [tokenA, tokenB, 0, input.feePips, 0] as const
      : [tokenA, tokenB, input.feePips, input.binStepBps, initial!.bin] as const;
    const functionName = input.model === "damm" ? "createPool" : "createDlmmPool";
    let simulationPassed = false;
    if (authorized && existing === zeroAddress) {
      await this.client.simulateContract({ account: wallet, address: this.factory, abi: poolFactoryAbi, functionName, args });
      simulationPassed = true;
    }
    return { chainId: this.chainId, factory: this.factory, poolId, model: input.model,
      token0: asset0, token1: asset1, feePips: input.feePips, binStepBps: input.binStepBps,
      initialBin: initial?.bin ?? null, representedPrice: initial ? formatUnits(BigInt(initial.priceX18) * 10n ** BigInt(asset0.decimals) / 10n ** BigInt(asset1.decimals), 18) : null,
      existingPool: existing === zeroAddress ? null : existing, authorized: Boolean(authorized), simulationPassed,
      permissionNotice: authorized ? null : "This factory currently requires governance/admin authorization. A Safe owner wallet is not the Safe itself. No transaction will be sent from an unauthorized wallet.",
      transaction: { to: this.factory, data: encodeFunctionData({ abi: poolFactoryAbi, functionName, args }), value: "0x0" },
      expiresAt: Date.now() + 5 * 60 * 1000,
    };
  }
}

import {
  encodeFunctionData,
  parseAbi,
  getAddress,
  parseUnits,
  formatUnits,
  type Abi,
  type Address,
} from "viem";
import { check, type runtime } from "./pons-dlmm-runtime.js";
import { observeDlmmReference } from "./dlmm-reference-price.js";

const tokenAbi = parseAbi([
  "function symbol() view returns(string)",
  "function name() view returns(string)",
  "function decimals() view returns(uint8)",
  "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)",
  "function liquidityPool() view returns(address)",
]);
const sourceAbi = parseAbi([
  "function token0() view returns(address)",
  "function token1() view returns(address)",
  "function factory() view returns(address)",
  "function WETH9() view returns(address)",
  "function fee() view returns(uint24)",
  "function liquidity() view returns(uint128)",
  "function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)",
  "function observe(uint32[]) view returns(int56[],uint160[])",
  "function getPool(address,address,uint24) view returns(address)",
]);
const quoteAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns(uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
]);
const sourceRouterAbi = parseAbi([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns(uint256)",
  "function multicall(uint256 deadline,bytes[] data) payable returns(bytes[])",
]);

export async function preparePonsSource(
  r: Awaited<ReturnType<typeof runtime>>,
) {
  const { config: cfg, client: c, account, journal: j } = r;
  const pons = getAddress(cfg.pons);
  const weth = getAddress(process.env.EXECUTION_WETH_ADDRESS!);
  const usdg = getAddress(process.env.EXECUTION_USDG_ADDRESS!);
  const balance = (token: Address) =>
    c.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [account.address],
    });
  const readSource = (
    address: Address,
    functionName: string,
    args?: readonly unknown[],
  ) => c.readContract({ address, abi: sourceAbi as Abi, functionName, args });
  const metadata = [];
  for (const [address, symbol, decimals] of [
    [pons, "PONS", 18],
    [weth, "WETH", 18],
    [usdg, "USDG", 6],
  ] as const) {
    const actual = await c.readContract({
      address,
      abi: tokenAbi,
      functionName: "symbol",
    });
    const precision = await c.readContract({
      address,
      abi: tokenAbi,
      functionName: "decimals",
    });
    check(
      actual === symbol && precision === decimals,
      "Token identity mismatch",
    );
    metadata.push({
      address,
      symbol,
      decimals,
      name: await c.readContract({
        address,
        abi: tokenAbi,
        functionName: "name",
      }),
    });
  }
  check(
    cfg.purchaseWethRaw === "10000000000000" &&
      cfg.maximumUsdgRaw === "30000" &&
      cfg.slippageBps === 100,
    "Owner-approved limits changed",
  );
  const pool = getAddress(cfg.sourcePool);
  check(
    (await c.readContract({
      address: pons,
      abi: tokenAbi,
      functionName: "liquidityPool",
    })) === pool,
    "PONS canonical pool changed",
  );
  check(
    (await readSource(pool, "token0")) === weth &&
      (await readSource(pool, "token1")) === pons,
    "Source token ordering mismatch",
  );
  check(
    (await readSource(pool, "factory")) === getAddress(cfg.sourceFactory),
    "Source factory mismatch",
  );
  check(
    (await readSource(pool, "fee")) === cfg.sourceFeePips,
    "Source fee mismatch",
  );
  check(
    ((await readSource(pool, "liquidity")) as bigint) > 0n,
    "Source has no liquidity",
  );
  check(
    (await readSource(getAddress(cfg.sourceRouter), "factory")) ===
      getAddress(cfg.sourceFactory),
    "Router factory mismatch",
  );
  check(
    (await readSource(getAddress(cfg.sourceRouter), "WETH9")) === weth,
    "Router WETH mismatch",
  );
  check(
    (await readSource(getAddress(cfg.sourceFactory), "getPool", [
      weth,
      pons,
      cfg.sourceFeePips,
    ])) === pool,
    "Source factory pool mismatch",
  );
  async function reference() {
    const spot = (await readSource(pool, "slot0")) as readonly [
      bigint,
      number,
      ...unknown[],
    ];
    const observations = (await readSource(pool, "observe", [
      [300, 0],
    ])) as readonly [readonly bigint[], unknown];
    const meanTick = Number((observations[0][1]! - observations[0][0]!) / 300n);
    check(
      Math.abs(spot[1] - meanTick) <= 100,
      "PONS spot diverges from five-minute TWAP",
    );
    const eth = await observeDlmmReference();
    const ponsUsdgX18 =
      (parseUnits(eth.wethPriceUsdg, 18) * (1n << 192n)) / (spot[0] * spot[0]);
    return {
      observedAt: new Date().toISOString(),
      spotTick: spot[1],
      meanTick,
      ponsUsdg: formatUnits(ponsUsdgX18, 18),
      eth,
    };
  }
  async function quoteBuy() {
    const { result } = await c.simulateContract({
      address: getAddress(cfg.sourceQuoter),
      abi: quoteAbi,
      functionName: "quoteExactInputSingle",
      args: [
        {
          tokenIn: weth,
          tokenOut: pons,
          amountIn: BigInt(cfg.purchaseWethRaw),
          fee: cfg.sourceFeePips,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });
    check(result[0] > 0n, "Empty purchase quote");
    return result[0];
  }
  async function approve(
    name: string,
    token: Address,
    spender: Address,
    amount: bigint,
  ) {
    const allowance = await c.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "allowance",
      args: [account.address, spender],
    });
    if (allowance === amount || (allowance === 0n && amount === 0n)) return;
    if (allowance > 0n && amount > 0n)
      await r.contract(
        `${name}:reset`,
        token,
        tokenAbi,
        "approve",
        [spender, 0n],
        100000n,
      );
    await r.contract(
      name,
      token,
      tokenAbi,
      "approve",
      [spender, amount],
      100000n,
    );
  }

  async function buy() {
    if (j.purchase?.received && j.steps.purchase?.receipt) {
      console.log(
        "Purchase already completed; reusing receipt without spending again",
      );
      return;
    }
    if (!j.purchase) {
      j.purchase = {
        before: String(await balance(pons)),
        quoteOut: String(await quoteBuy()),
        reference: await reference(),
      };
      j.purchase.minimumOut = String(
        (BigInt(j.purchase.quoteOut) * 99n) / 100n,
      );
      await r.save();
    }
    if (!j.steps.purchase) {
      check(
        (await balance(weth)) >= BigInt(cfg.purchaseWethRaw),
        "Insufficient WETH",
      );
      check(
        (await quoteBuy()) >= BigInt(j.purchase.minimumOut),
        "Quote moved beyond approved slippage",
      );
      await reference();
      await approve(
        "approve:purchase",
        weth,
        getAddress(cfg.sourceRouter),
        BigInt(cfg.purchaseWethRaw),
      );
    }
    const swap = encodeFunctionData({
      abi: sourceRouterAbi,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn: weth,
          tokenOut: pons,
          fee: cfg.sourceFeePips,
          recipient: account.address,
          amountIn: BigInt(cfg.purchaseWethRaw),
          amountOutMinimum: BigInt(j.purchase.minimumOut),
          sqrtPriceLimitX96: 0n,
        },
      ],
    });
    await r.contract(
      "purchase",
      getAddress(cfg.sourceRouter),
      sourceRouterAbi,
      "multicall",
      [BigInt(Math.floor(Date.now() / 1000) + 180), [swap]],
      350000n,
    );
    const received = (await balance(pons)) - BigInt(j.purchase.before);
    check(
      received >= BigInt(j.purchase.minimumOut),
      "PONS balance delta below minimum",
    );
    j.purchase.received = String(received);
    await r.save();
    await approve("clear:purchase", weth, getAddress(cfg.sourceRouter), 0n);
    return;
  }
  return {
    pons,
    weth,
    usdg,
    balance,
    metadata,
    reference,
    quoteBuy,
    approve,
    buy,
  };
}

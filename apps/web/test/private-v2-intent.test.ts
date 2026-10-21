import assert from "node:assert/strict";
import test from "node:test";
import { decodeFunctionData, encodeAbiParameters, keccak256 } from "viem";
import { privateVaultV2Abi } from "@zkblast/abi";
import {
  privateActionPublicInputsV2,
  shieldedTermsHashV2,
  shieldedTermsLimbsV2,
  type ShieldedTermsV2,
} from "@zkblast/sdk";
import {
  decodeActionStatementV2,
  encodeActionStatementV2,
  encodeReservationV2,
  fieldHexV2,
} from "../src/lib/private-v2-intent";
import { quotePrivateActionV2 } from "../src/lib/private-v2-quotes";
import type { NoteScopeV2 } from "../src/lib/notecrypto-v2";
import type {
  ProtocolExecutionPool,
  EthereumProvider,
} from "../src/types/application";
import { dammPoolAbi } from "@zkblast/abi";
import { encodeFunctionResult } from "viem";

const a = "0x0000000000000000000000000000000000001000";
const b = "0x0000000000000000000000000000000000002000";
const poolAddress = "0x0000000000000000000000000000000000003000";
const vault = "0x0000000000000000000000000000000000004000";
const scope: NoteScopeV2 = {
  environment: "testnet",
  chainId: "46630",
  settlement: vault,
  treeVersion: "2",
};

test("mainnet private statements preserve chain/vault binding and cannot restore as testnet", () => {
  const mainnetTerms = { ...terms, chainId: 4663n };
  const mainnetSignals: [...typeof signals] = [...signals];
  const limbs = shieldedTermsLimbsV2(shieldedTermsHashV2(mainnetTerms));
  mainnetSignals[1] = 4663n;
  mainnetSignals[6] = BigInt(limbs.terms_low);
  mainnetSignals[7] = BigInt(limbs.terms_high);
  const statement = encodeActionStatementV2(mainnetTerms, mainnetSignals, 32);
  const mainnetScope: NoteScopeV2 = {
    ...scope,
    environment: "mainnet",
    chainId: "4663",
  };
  assert.equal(
    decodeActionStatementV2(statement, mainnetScope).sdkTerms.chainId,
    4663n,
  );
  assert.throws(() => decodeActionStatementV2(statement, scope), /BINDING/u);
});
const terms: ShieldedTermsV2 = {
  chainId: 46630n,
  settlement: vault,
  action: "swap",
  pool: poolAddress,
  model: "damm",
  binId: 0n,
  asset0: a,
  asset1: b,
  amount0: 100n,
  amount1: 0n,
  shares: 0n,
  minimum0: 0n,
  minimum1: 80n,
  minimumShares: 0n,
  maximumFee0: 0n,
  maximumFee1: 0n,
  feeRecipient: vault,
  deadline: 2000000000n,
  refundCommitment: keccak256(
    encodeAbiParameters(
      [{ type: "bytes32[3]" }],
      [[fieldHexV2(13n), fieldHexV2(0n), fieldHexV2(0n)]],
    ),
  ),
  outputCommitment0: fieldHexV2(0n),
  outputCommitment1: fieldHexV2(12n),
};
const signals = privateActionPublicInputsV2({
  schemaVersion: 2,
  chainId: 46630n,
  settlement: vault,
  treeVersion: 2n,
  merkleRoot: 1n,
  action: "swap",
  termsHash: shieldedTermsHashV2(terms),
  deadline: terms.deadline,
  asset0: a,
  asset1: b,
  pool: poolAddress,
  model: "damm",
  binId: 0n,
  nullifiers: [11n, 0n, 0n],
  outputCommitments: [0n, 12n, 0n],
  refundCommitments: [13n, 0n, 0n],
  poolInflows: [0n, 80n, 0n],
  poolOutflows: [100n, 0n, 0n],
  fees: [0n, 0n, 0n],
});

test("private statement roundtrips exact vault ABI and produces a reserve payload with stable intent identity", () => {
  const statement = encodeActionStatementV2(terms, signals, 32);
  const decoded = decodeActionStatementV2(statement, scope);
  assert.deepEqual(decoded.inputs, signals);
  assert.deepEqual(decoded.sdkTerms, terms);
  const data = encodeReservationV2(statement, scope, `0x${"0".repeat(512)}`);
  assert.equal(
    decodeFunctionData({ abi: privateVaultV2Abi, data }).functionName,
    "reserve",
  );
  assert.equal(decodeActionStatementV2(statement, scope).id, decoded.id);
  assert.throws(
    () => decodeActionStatementV2(statement, { ...scope, chainId: "4663" }),
    /BINDING/u,
  );
  assert.throws(
    () => decodeActionStatementV2(`${statement}00`, scope),
    /NONCANONICAL/u,
  );
  const altered: [...typeof signals] = [...signals];
  altered[20] = 14n;
  assert.throws(
    () => encodeActionStatementV2(terms, altered, 32),
    /REFUND_DIGEST/u,
  );
});

test("liquidity quote is pinned to one block and follows pool share rounding for add/remove", async () => {
  const pool: ProtocolExecutionPool = {
    chainId: 46630,
    address: poolAddress,
    model: "damm",
    feeBps: 30,
    status: "active",
    createdBlock: "1",
    token0Address: a,
    token0Symbol: "A",
    token0Decimals: 6,
    token1Address: b,
    token1Symbol: "B",
    token1Decimals: 6,
  };
  const provider: EthereumProvider = {
    request: async ({ method, params }) => {
      if (method === "eth_getBlockByNumber")
        return { number: "0x64", timestamp: "0x3e8" };
      assert.equal(method, "eth_call");
      assert.equal(params?.[1], "0x64");
      const { data } = params?.[0] as { data: `0x${string}` };
      const { functionName } = decodeFunctionData({ abi: dammPoolAbi, data });
      if (functionName === "token0" || functionName === "token1")
        return encodeFunctionResult({
          abi: dammPoolAbi,
          functionName,
          result: functionName === "token0" ? a : b,
        });
      if (
        functionName === "reserve0" ||
        functionName === "reserve1" ||
        functionName === "totalShares" ||
        functionName === "MINIMUM_LIQUIDITY"
      )
        return encodeFunctionResult({
          abi: dammPoolAbi,
          functionName,
          result: functionName === "reserve1" ? 2000n : 1000n,
        });
      throw new Error("UNEXPECTED_READ");
    },
  };
  assert.deepEqual(
    (await quotePrivateActionV2(provider, pool, "add", [100n, 200n, 0n], 0))
      .inflows,
    [0n, 0n, 100n],
  );
  assert.deepEqual(
    (await quotePrivateActionV2(provider, pool, "remove", [0n, 0n, 100n], 0))
      .inflows,
    [100n, 200n, 0n],
  );
});

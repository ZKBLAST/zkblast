import { erc20Abi, privateVaultV2Abi } from "@zkblast/abi";
import { fundPublicInputsV2 } from "@zkblast/sdk";
import type { PrivateProverReleaseV2 } from "@zkblast/config";
import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";
import type { EthereumProvider } from "@/types/application";
import { calculatePrivateNoteV2 } from "./private-v2-notes";
import { proveInBrowserV2, type PrivateProofV2 } from "./private-v2-prover";
import type { StoredNoteV2 } from "./notecrypto-v2";
import { fetchPrivatePathV2 } from "./private-v2-path";
import { waitForReceipt } from "./swap-flow";

export function encodePrivateProofV2({ proof }: PrivateProofV2): Hex {
  return encodeAbiParameters(
    [{ type: "uint256[2]" }, { type: "uint256[2][2]" }, { type: "uint256[2]" }],
    [
      [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])],
      [
        [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
        [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
      ],
      [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])],
    ],
  );
}

export async function assertPrivateWalletV2(
  provider: EthereumProvider,
  account: Address,
  chainId: string,
): Promise<void> {
  if (
    BigInt((await provider.request({ method: "eth_chainId" })) as string) !==
    BigInt(chainId)
  )
    throw new Error("V2_SWITCH_TO_CONFIGURED_TESTNET");
  const accounts = (await provider.request({
    method: "eth_accounts",
  })) as string[];
  if (
    !Array.isArray(accounts) ||
    !accounts.some((value) => value.toLowerCase() === account.toLowerCase())
  )
    throw new Error("WALLET_ACCOUNT_CHANGED");
}

export async function sendPrivateTransactionV2(
  provider: EthereumProvider,
  account: Address,
  chainId: string,
  to: Address,
  data: Hex,
  action: string,
  onSubmitted?: (hash: Hex) => Promise<void>,
): Promise<Hex> {
  await assertPrivateWalletV2(provider, account, chainId);
  const tx = { from: account, to, data, value: "0x0" };
  await provider.request({ method: "eth_call", params: [tx, "latest"] });
  const hash = await provider.request({
    method: "eth_sendTransaction",
    params: [tx],
  });
  if (typeof hash !== "string" || !/^0x[0-9a-f]{64}$/iu.test(hash))
    throw new Error("INVALID_TRANSACTION_HASH");
  await onSubmitted?.(hash as Hex);
  await waitForReceipt(provider, hash, 40, {
    chainId: Number(chainId),
    action,
  });
  return hash as Hex;
}

export async function fundPrivateNoteV2(
  args: Readonly<{
    operation: "deposit" | "withdraw";
    note: StoredNoteV2;
    manifest: PrivateProverReleaseV2;
    provider: EthereumProvider;
    account: Address;
    onStage: (stage: string) => void;
    onSubmitted: (hash: Hex) => Promise<void>;
  }>,
): Promise<Hex> {
  const { operation, note, manifest, provider, account, onStage } = args;
  if (note.resource.kind !== "token")
    throw new Error("REMOVE_PRIVATE_LP_BEFORE_WITHDRAWAL");
  await assertPrivateWalletV2(provider, account, note.scope.chainId);
  const vault = note.scope.settlement;
  const pauseGetter =
    operation === "deposit" ? "depositsPaused" : "withdrawalsPaused";
  const paused = (await provider.request({
    method: "eth_call",
    params: [
      {
        to: vault,
        data: encodeFunctionData({
          abi: privateVaultV2Abi,
          functionName: pauseGetter,
        }),
      },
      "latest",
    ],
  })) as Hex;
  if (
    decodeFunctionResult({
      abi: privateVaultV2Abi,
      functionName: pauseGetter,
      data: paused,
    })
  )
    throw new Error("V2_VAULT_OPERATION_PAUSED");
  const tree = (await provider.request({
    method: "eth_call",
    params: [
      {
        to: vault,
        data: encodeFunctionData({
          abi: privateVaultV2Abi,
          functionName: "treeVersion",
        }),
      },
      "latest",
    ],
  })) as Hex;
  if (
    decodeFunctionResult({
      abi: privateVaultV2Abi,
      functionName: "treeVersion",
      data: tree,
    }) !== BigInt(note.scope.treeVersion)
  )
    throw new Error("V2_DEPLOYED_TREE_MISMATCH");
  if (operation === "deposit") {
    const enabled = (await provider.request({
      method: "eth_call",
      params: [
        {
          to: vault,
          data: encodeFunctionData({
            abi: privateVaultV2Abi,
            functionName: "assetEnabled",
            args: [note.resource.address],
          }),
        },
        "latest",
      ],
    })) as Hex;
    if (
      !decodeFunctionResult({
        abi: privateVaultV2Abi,
        functionName: "assetEnabled",
        data: enabled,
      })
    )
      throw new Error("V2_ASSET_NOT_ENABLED");
  }
  const identity = await calculatePrivateNoteV2(note, manifest);
  if (identity.commitment !== note.commitment)
    throw new Error("V2_NOTE_COMMITMENT_MISMATCH");
  let siblings = Array<string>(32).fill("0");
  let directions = Array<number>(32).fill(0);
  let root = 0n;
  let leafIndex = 0;
  if (operation === "withdraw") {
    onStage("Syncing private note path");
    const path = await fetchPrivatePathV2(BigInt(note.commitment));
    if (
      path.siblings.length !== 32 ||
      path.directions.length !== 32 ||
      !Number.isSafeInteger(path.leafIndex) ||
      path.leafIndex < 0 ||
      path.leafIndex >= 2 ** 32
    )
      throw new Error("INVALID_V2_MERKLE_PATH");
    siblings = path.siblings.map((value) => String(BigInt(value)));
    directions = path.directions;
    root = BigInt(path.root);
    leafIndex = path.leafIndex;
  }
  const common = {
    schemaVersion: 2 as const,
    chainId: BigInt(note.scope.chainId),
    settlement: vault,
    treeVersion: BigInt(note.scope.treeVersion),
    asset: note.resource.address,
    amount: BigInt(note.amount),
  };
  const signals = fundPublicInputsV2(
    operation === "deposit"
      ? { ...common, operation, commitment: BigInt(note.commitment) }
      : {
          ...common,
          operation,
          merkleRoot: root,
          nullifier: BigInt(identity.nullifier),
          recipient: account,
        },
  );
  const names = [
    "schema_version",
    "operation",
    "chain_id",
    "settlement",
    "tree_version",
    "merkle_root",
    "nullifier",
    "asset",
    "amount",
    "recipient",
    "commitment",
  ];
  const input = {
    ...Object.fromEntries(
      names.map((name, index) => [name, String(signals[index])]),
    ),
    secret: note.secret,
    nonce: note.nonce,
    leaf_index: String(leafIndex),
    path_siblings: siblings,
    path_directions: directions.map(String),
  };
  const result = await proveInBrowserV2(
    {
      kind: "fund",
      scope: note.scope,
      manifest: { ...manifest, ...manifest.fund, ...note.scope },
      input,
      expectedPublicInputs: signals.map(String),
    },
    {
      onStage: (stage) =>
        onStage(
          stage === "proving"
            ? "Generating proof locally"
            : "Verifying proof locally",
        ),
    },
  );
  if (operation === "deposit") {
    onStage("Checking token approval");
    const allowanceData = encodeFunctionData({
      abi: erc20Abi,
      functionName: "allowance",
      args: [account, vault],
    });
    const raw = (await provider.request({
      method: "eth_call",
      params: [{ to: note.resource.address, data: allowanceData }, "latest"],
    })) as Hex;
    const allowance = decodeFunctionResult({
      abi: erc20Abi,
      functionName: "allowance",
      data: raw,
    });
    if (allowance < BigInt(note.amount)) {
      if (allowance > 0n)
        await sendPrivateTransactionV2(
          provider,
          account,
          note.scope.chainId,
          note.resource.address,
          encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [vault, 0n],
          }),
          "Reset private vault approval",
        );
      await sendPrivateTransactionV2(
        provider,
        account,
        note.scope.chainId,
        note.resource.address,
        encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [vault, BigInt(note.amount)],
        }),
        "Approve private vault deposit",
      );
    }
  }
  onStage("Confirm transaction in wallet");
  const data = encodeFunctionData({
    abi: privateVaultV2Abi,
    functionName: operation,
    args: [encodePrivateProofV2(result), signals],
  });
  return sendPrivateTransactionV2(
    provider,
    account,
    note.scope.chainId,
    vault,
    data,
    operation === "deposit" ? "Private v2 deposit" : "Private v2 withdrawal",
    args.onSubmitted,
  );
}

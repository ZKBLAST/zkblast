import { zkBlastVaultAbi } from "@zkblast/abi";
import {
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";
import type { EthereumProvider } from "@/types/application";
import { apiRequest } from "./api-client";
import { calculateNoteCircuit, commitmentHex } from "./note-circuit";
import type { ShieldedNoteV1 } from "./notecrypto";
import { waitForReceipt } from "./swap-flow";

export type WithdrawStage =
  | "syncing-root"
  | "building-witness"
  | "proving"
  | "verifying"
  | "submitting"
  | "confirmed";

type MerklePath = Readonly<{
  commitment: Hex;
  leafIndex: number;
  root: Hex;
  siblings: readonly Hex[];
  directions: readonly number[];
  syncedBlock: string;
}>;
type Groth16Proof = Readonly<{
  pi_a: readonly [string, string, string];
  pi_b: readonly [
    readonly [string, string, string],
    readonly [string, string, string],
    readonly [string, string, string],
  ];
  pi_c: readonly [string, string, string];
}>;
type WorkerResult = Readonly<{
  id: string;
  stage?: "proving" | "verifying" | "complete";
  proof?: Groth16Proof;
  publicSignals?: readonly string[];
  error?: string;
}>;

const field = (address: string): string => BigInt(address).toString();

function prove(
  input: Readonly<Record<string, string | readonly string[]>>,
  onStage: (stage: WithdrawStage) => void,
): Promise<Readonly<{ proof: Groth16Proof; publicSignals: readonly string[] }>> {
  const id = crypto.randomUUID();
  const worker = new Worker("/zk/withdraw-worker.js");
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }: MessageEvent<WorkerResult>) => {
      if (data.id !== id) return;
      if (data.stage === "proving" || data.stage === "verifying")
        onStage(data.stage);
      if (data.error) {
        worker.terminate();
        reject(new Error(data.error));
      } else if (data.proof && data.publicSignals) {
        worker.terminate();
        resolve({ proof: data.proof, publicSignals: data.publicSignals });
      }
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("WITHDRAW_PROVER_WORKER_FAILED"));
    };
    worker.postMessage({ id, input });
  });
}

function encodeProof(proof: Groth16Proof): Hex {
  return encodeAbiParameters(
    [
      { type: "uint256[2]" },
      { type: "uint256[2][2]" },
      { type: "uint256[2]" },
    ],
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

export async function executeShieldedWithdrawal(
  provider: EthereumProvider,
  apiUrl: string,
  sender: Address,
  recipient: Address,
  note: ShieldedNoteV1,
  onStage: (stage: WithdrawStage) => void,
): Promise<ShieldedNoteV1> {
  if (note.status !== "unspent" || note.leafIndex === null)
    throw new Error("NOTE_NOT_SPENDABLE");
  onStage("syncing-root");
  const path = await apiRequest<MerklePath>(
    apiUrl,
    `/v1/shielded/path/${commitmentHex(note.commitment)}`,
  );
  if (path.leafIndex !== note.leafIndex) throw new Error("NOTE_INDEX_MISMATCH");
  onStage("building-witness");
  const values = await calculateNoteCircuit({
    chainId: note.chainId,
    vaultAddress: note.vaultAddress,
    assetAddress: note.assetAddress,
    amountRaw: note.amountRaw,
    secret: note.secret,
    nonce: note.nonce,
    pathSiblings: path.siblings.map((value) => BigInt(value).toString()),
    pathDirections: path.directions,
  });
  if (BigInt(values.merkleRoot) !== BigInt(path.root))
    throw new Error("LOCAL_ROOT_MISMATCH");
  const deadline = String(Math.floor(Date.now() / 1_000) + 3_600);
  const publicInputs = [
    "1",
    "1",
    String(note.chainId),
    field(note.vaultAddress),
    String(note.treeVersion),
    BigInt(path.root).toString(),
    values.nullifier,
    field(note.assetAddress),
    note.amountRaw,
    field(recipient),
    field(sender),
    "0",
    deadline,
  ] as const;
  const { proof, publicSignals } = await prove(
    {
      schema_version: publicInputs[0],
      action: publicInputs[1],
      chain_id: publicInputs[2],
      vault_address: publicInputs[3],
      tree_version: publicInputs[4],
      merkle_root: publicInputs[5],
      nullifier: publicInputs[6],
      asset_address: publicInputs[7],
      amount: publicInputs[8],
      recipient_address: publicInputs[9],
      relayer_address: publicInputs[10],
      relayer_fee: publicInputs[11],
      deadline: publicInputs[12],
      secret: note.secret,
      nonce: note.nonce,
      leaf_index: String(note.leafIndex),
      path_siblings: path.siblings.map((value) => BigInt(value).toString()),
      path_directions: path.directions.map(String),
    },
    onStage,
  );
  if (
    publicSignals.length !== publicInputs.length ||
    publicSignals.some((value, index) => BigInt(value) !== BigInt(publicInputs[index]))
  )
    throw new Error("PROOF_PUBLIC_INPUT_MISMATCH");
  onStage("submitting");
  const transactionHash = (await provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: sender,
        to: note.vaultAddress,
        data: encodeFunctionData({
          abi: zkBlastVaultAbi,
          functionName: "withdraw",
          args: [
            encodeProof(proof),
            publicInputs.map(BigInt) as unknown as readonly [
              bigint,
              bigint,
              bigint,
              bigint,
              bigint,
              bigint,
              bigint,
              bigint,
              bigint,
              bigint,
              bigint,
              bigint,
              bigint,
            ],
          ],
        }),
        value: "0x0",
      },
    ],
  })) as Hex;
  const receipt = (await waitForReceipt(provider, transactionHash)) as {
    logs?: readonly { address: Address; data: Hex; topics: readonly Hex[] }[];
  };
  const withdrawn = receipt.logs?.some((log) => {
    if (log.address.toLowerCase() !== note.vaultAddress.toLowerCase()) return false;
    try {
      const event = decodeEventLog({
        abi: zkBlastVaultAbi,
        eventName: "NoteWithdrawn",
        data: log.data,
        topics: [...log.topics] as [Hex, ...Hex[]],
      });
      return event.args.nullifier.toLowerCase() ===
        `0x${BigInt(values.nullifier).toString(16).padStart(64, "0")}`;
    } catch {
      return false;
    }
  });
  if (!withdrawn) throw new Error("WITHDRAW_EVENT_MISSING");
  onStage("confirmed");
  return { ...note, status: "spent" };
}

import type { NoteEnvironment, ShieldedNoteV1 } from "./notecrypto";

const addressPattern = /^0x[0-9a-fA-F]{40}$/u;
const BN254_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

type CircuitResult = Readonly<{
  commitment: string;
  merkleRoot: string;
  nullifier: string;
}>;
type Pending = Readonly<{
  resolve: (value: CircuitResult) => void;
  reject: (reason: Error) => void;
}>;
let worker: Worker | null = null;
const pending = new Map<string, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker("/zk/note-worker.js");
  worker.onmessage = ({
    data,
  }: MessageEvent<{ id: string; result?: CircuitResult; error?: string }>) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.result) request.resolve(data.result);
    else request.reject(new Error(data.error ?? "NOTE_CIRCUIT_FAILED"));
  };
  worker.onerror = () => {
    for (const request of pending.values())
      request.reject(new Error("NOTE_CIRCUIT_WORKER_FAILED"));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function randomField(bytes: number): string {
  const value = crypto
    .getRandomValues(new Uint8Array(bytes))
    .reduce((total, byte) => (total << 8n) | BigInt(byte), 0n);
  return ((value % (BN254_FIELD - 1n)) + 1n).toString();
}

const addressField = (address: string): string => BigInt(address).toString();

export async function calculateNoteCircuit(input: Readonly<{
  chainId: number;
  vaultAddress: `0x${string}`;
  assetAddress: `0x${string}`;
  amountRaw: string;
  secret: string;
  nonce: string;
  pathSiblings: readonly string[];
  pathDirections: readonly number[];
}>): Promise<CircuitResult> {
  if (input.pathSiblings.length !== 32 || input.pathDirections.length !== 32)
    throw new Error("INVALID_MERKLE_PATH");
  const id = crypto.randomUUID();
  return new Promise<CircuitResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({
      id,
      input: {
        chain_id: String(input.chainId),
        vault_address: addressField(input.vaultAddress),
        asset_address: addressField(input.assetAddress),
        amount: input.amountRaw,
        secret: input.secret,
        nonce: input.nonce,
        path_siblings: input.pathSiblings,
        path_directions: input.pathDirections.map(String),
      },
    });
  });
}

export async function createShieldedNote(
  input: Readonly<{
    environment: NoteEnvironment;
    chainId: number;
    vaultAddress: `0x${string}`;
    treeVersion: number;
    assetAddress: `0x${string}`;
    amountRaw: string;
  }>,
): Promise<ShieldedNoteV1> {
  if (
    !addressPattern.test(input.vaultAddress) ||
    !addressPattern.test(input.assetAddress)
  )
    throw new Error("INVALID_NOTE_DOMAIN");
  if (
    !Number.isSafeInteger(input.chainId) ||
    input.chainId <= 0 ||
    !Number.isSafeInteger(input.treeVersion) ||
    input.treeVersion <= 0
  )
    throw new Error("INVALID_NOTE_DOMAIN");
  if (!/^[1-9][0-9]*$/u.test(input.amountRaw))
    throw new Error("INVALID_NOTE_AMOUNT");
  const secret = randomField(31);
  const nonce = randomField(16);
  const result = await calculateNoteCircuit({
    ...input,
    secret,
    nonce,
    pathSiblings: Array.from({ length: 32 }, () => "0"),
    pathDirections: Array.from({ length: 32 }, () => 0),
  });
  return {
    format: "zkblast-note",
    version: 1,
    environment: input.environment,
    chainId: input.chainId,
    vaultAddress: input.vaultAddress,
    treeVersion: input.treeVersion,
    assetAddress: input.assetAddress,
    amountRaw: input.amountRaw,
    secret,
    nonce,
    commitment: result.commitment,
    leafIndex: null,
    transactionHash: null,
    createdAt: new Date().toISOString(),
    status: "prepared",
  };
}

export function commitmentHex(commitment: string): `0x${string}` {
  const value = BigInt(commitment);
  if (value <= 0n || value >= BN254_FIELD)
    throw new Error("INVALID_COMMITMENT_FIELD");
  return `0x${value.toString(16).padStart(64, "0")}`;
}

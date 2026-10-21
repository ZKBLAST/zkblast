import { shieldedNoteWitnessV2 } from "@zkblast/sdk";
import type { PrivateProverReleaseV2 } from "@zkblast/config";
import {
  validateStoredNoteV2,
  type NoteScopeV2,
  type StoredNoteV2,
} from "./notecrypto-v2";

export function calculatePrivateNoteV2(
  note: StoredNoteV2,
  manifest: PrivateProverReleaseV2,
): Promise<{ commitment: string; nullifier: string }> {
  const validated = validateStoredNoteV2(note, manifest as NoteScopeV2);
  const input = shieldedNoteWitnessV2({
    schemaVersion: 2,
    chainId: BigInt(validated.scope.chainId),
    settlement: validated.scope.settlement,
    treeVersion: BigInt(validated.scope.treeVersion),
    resource:
      validated.resource.kind === "token"
        ? { kind: "token", address: validated.resource.address }
        : {
            kind: "lp",
            address: validated.resource.address,
            model: validated.resource.model!,
            binId: BigInt(validated.resource.binId!),
          },
    amount: BigInt(validated.amount),
    secret: BigInt(validated.secret),
    nonce: BigInt(validated.nonce),
  });
  const worker = new Worker("/zk/private-v2-note-worker.js");
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const fail = () => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error("V2_NOTE_CALCULATION_FAILED"));
    };
    const timeout = setTimeout(fail, 30_000);
    worker.onerror = fail;
    worker.onmessage = ({
      data,
    }: MessageEvent<{
      id: string;
      error?: string;
      commitment?: string;
      nullifier?: string;
    }>) => {
      if (data.id !== id) return;
      if (data.error || !data.commitment || !data.nullifier) {
        fail();
        return;
      }
      clearTimeout(timeout);
      worker.terminate();
      resolve({ commitment: data.commitment, nullifier: data.nullifier });
    };
    try {
      worker.postMessage({ id, input, asset: manifest.noteCalculator });
    } catch {
      fail();
    }
  });
}

const random = (length: number): string => {
  let value = 0n;
  while (value === 0n)
    value = crypto
      .getRandomValues(new Uint8Array(length))
      .reduce((total, byte) => (total << 8n) | BigInt(byte), 0n);
  return String(value);
};

export async function createPrivateNoteV2(
  scope: NoteScopeV2,
  resource: StoredNoteV2["resource"],
  amount: string,
  role: StoredNoteV2["role"],
  manifest: PrivateProverReleaseV2,
): Promise<StoredNoteV2> {
  const draft: StoredNoteV2 = {
    version: 2,
    scope,
    resource,
    amount,
    role,
    secret: random(31),
    nonce: random(16),
    commitment: "1",
  };
  const { commitment } = await calculatePrivateNoteV2(draft, manifest);
  return validateStoredNoteV2({ ...draft, commitment }, scope);
}

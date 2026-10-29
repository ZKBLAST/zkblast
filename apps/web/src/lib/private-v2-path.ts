import type { Hex } from "viem";
import { apiRequest } from "./api-client";

export type PrivatePathV2 = Readonly<{
  root: Hex;
  leafIndex: number;
  siblings: Hex[];
  directions: number[];
}>;

const PRIVATE_PATH_TIMEOUT_MS = 45_000;

export async function fetchPrivatePathV2(
  commitment: bigint,
): Promise<PrivatePathV2> {
  const encoded = `0x${commitment.toString(16).padStart(64, "0")}`;
  const path = `/v1/shielded-v2/path/${encoded}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await apiRequest<PrivatePathV2>("/api", path, {
        signal: AbortSignal.timeout(PRIVATE_PATH_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === "TimeoutError" ||
          error.message.toLowerCase().includes("timed out"));
      if (!timedOut || attempt === 1)
        throw new Error(
          timedOut
            ? "PRIVATE_NOTE_PATH_TEMPORARILY_UNAVAILABLE"
            : error instanceof Error
              ? error.message
              : "PRIVATE_NOTE_PATH_FAILED",
        );
    }
  }
  throw new Error("PRIVATE_NOTE_PATH_TEMPORARILY_UNAVAILABLE");
}

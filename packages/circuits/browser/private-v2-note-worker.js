import buildWitnessCalculator from "zkblast-v2-calculator";

self.onmessage = async ({ data }) => {
  const { id, input, asset } = data;
  try {
    if (
      !/^\/zk\/(testnet|mainnet)\/v2\/[a-zA-Z0-9_-]+\.wasm$/u.test(
        asset?.path,
      ) ||
      !(
        (input?.chain_id === "46630" &&
          asset.path.startsWith("/zk/testnet/v2/")) ||
        (input?.chain_id === "4663" && asset.path.startsWith("/zk/mainnet/v2/"))
      ) ||
      !/^[a-f0-9]{64}$/u.test(asset?.sha256)
    )
      throw new Error("INVALID_ASSET");
    const response = await fetch(asset.path, {
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error("ASSET_UNAVAILABLE");
    const wasm = await response.arrayBuffer();
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", wasm)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    if (digest !== asset.sha256) throw new Error("ASSET_HASH_MISMATCH");
    const calculator = await buildWitnessCalculator(wasm);
    const witness = await calculator.calculateWitness(
      {
        ...input,
        action: "0",
        terms_low: "0",
        terms_high: "0",
        deadline: "0",
        path_siblings: Array(32).fill("0"),
        path_directions: Array(32).fill("0"),
      },
      1,
    );
    self.postMessage({
      id,
      commitment: witness[1].toString(),
      nullifier: witness[3].toString(),
    });
  } catch {
    self.postMessage({ id, error: "V2_NOTE_CALCULATION_FAILED" });
  }
};

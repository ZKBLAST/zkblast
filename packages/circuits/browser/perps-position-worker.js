import buildWitnessCalculator from "zkblast-v2-calculator";

self.onmessage = async ({ data }) => {
  const { id, input, asset, environment } = data;
  try {
    if (
      !["testnet", "mainnet"].includes(environment)
        || !asset?.path?.startsWith(`/zk/${environment}/perps-v1/`)
        || !/^[a-f0-9]{64}$/u.test(asset?.sha256)
    ) throw new Error("INVALID_POSITION_CALCULATOR");
    const response = await fetch(asset.path, {
      credentials: "omit", redirect: "error", signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error("POSITION_CALCULATOR_UNAVAILABLE");
    const wasm = await response.arrayBuffer();
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", wasm)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    if (digest !== asset.sha256) throw new Error("POSITION_CALCULATOR_HASH_MISMATCH");
    const witness = await (await buildWitnessCalculator(wasm)).calculateWitness(input, 1);
    self.postMessage({
      id,
      commitment: witness[1].toString(),
      nullifier: witness[2].toString(),
    });
  } catch {
    self.postMessage({ id, error: "PERPS_POSITION_CALCULATION_FAILED" });
  }
};

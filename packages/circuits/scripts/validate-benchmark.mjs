import { readFile } from "node:fs/promises";

const acceptance = JSON.parse(
  await readFile(
    new URL("../benchmark/acceptance.json", import.meta.url),
    "utf8",
  ),
);
const results = JSON.parse(
  await readFile(new URL("../benchmark/results.json", import.meta.url), "utf8"),
);
if (results.status !== "complete") throw new Error("BENCHMARK_RESULTS_PENDING");
for (const candidate of acceptance.requiredCandidates) {
  const result = results.candidates[candidate];
  if (!result) throw new Error(`MISSING_BENCHMARK_${candidate}`);
}
const candidate = acceptance.selectedCandidate;
const result = results.candidates[candidate];
if (!result) throw new Error(`MISSING_SELECTED_BENCHMARK_${candidate}`);
if (!result.browserVerificationPassed)
  throw new Error(`${candidate}_BROWSER_VERIFICATION_FAILED`);
if (!result.evmVerificationPassed)
  throw new Error(`${candidate}_EVM_VERIFICATION_FAILED`);
if (result.medianProofMs > acceptance.desktopMedianProofMsMaximum)
  throw new Error(`${candidate}_MEDIAN_TOO_SLOW`);
if (result.p95ProofMs > acceptance.desktopP95ProofMsMaximum)
  throw new Error(`${candidate}_P95_TOO_SLOW`);
if (result.browserPeakMemoryBytes > acceptance.browserPeakMemoryBytesMaximum)
  throw new Error(`${candidate}_BROWSER_MEMORY_TOO_HIGH`);
if (result.verifierGas > acceptance.verifierGasMaximum)
  throw new Error(`${candidate}_VERIFIER_GAS_TOO_HIGH`);
console.log("Circuit benchmark acceptance passed");

const simulationErrorSelectors = new Map<string, string>([
  ["0xa1e56ace", "STALE_ORACLE_PRICE"],
]);

function findRevertSelector(value: unknown, visited = new Set<unknown>()): string | null {
  if (typeof value === "string") {
    const exact = /^0x([\da-f]{8})(?:[\da-f]{64})*$/iu.exec(value);
    return exact ? `0x${exact[1]!.toLowerCase()}` : null;
  }
  if (!value || typeof value !== "object" || visited.has(value)) return null;
  visited.add(value);
  const record = value as Record<string, unknown>;
  for (const key of ["data", "cause", "error", "details", "metaMessages"]) {
    const selector = findRevertSelector(record[key], visited);
    if (selector) return selector;
  }
  return null;
}

export function perpsRelaySimulationErrorCode(error: unknown): string {
  const selector = findRevertSelector(error);
  return (selector && simulationErrorSelectors.get(selector)) ?? "PERPS_RELAY_SIMULATION_FAILED";
}

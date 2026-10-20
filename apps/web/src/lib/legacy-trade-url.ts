type Search = Record<string, string | string[] | undefined>;

export function legacyTradeUrl(
  search: Search,
  defaults: { mode?: string; panel?: string; pool?: string } = {},
) {
  const params = new URLSearchParams();
  for (const key of ["pool", "market", "mode", "panel"] as const) {
    const value = search[key];
    if (typeof value === "string") params.set(key, value);
  }
  for (const [key, value] of Object.entries(defaults))
    if (value) params.set(key, value);
  const query = params.toString();
  return `/trade${query ? `?${query}` : ""}`;
}

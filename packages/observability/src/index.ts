const sensitiveKey =
  /(secret|private|mnemonic|witness|note|password|authorization|service.?role|api.?key|rpc.?url|database.?url|supabase)/iu;

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object")
    return redact(value as Readonly<Record<string, unknown>>);
  return value;
}

export function redact(
  fields: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      sensitiveKey.test(key) ? "[REDACTED]" : redactValue(value),
    ]),
  );
}

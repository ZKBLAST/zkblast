const sensitiveKey =
  /(secret|private|mnemonic|witness|note|password|authorization|service.role)/iu;

export function redact(
  fields: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      sensitiveKey.test(key) ? "[REDACTED]" : value,
    ]),
  );
}

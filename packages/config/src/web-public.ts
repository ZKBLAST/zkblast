import { z } from "zod";

const webPublicConfigSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url(),
});

export type WebPublicConfig = Readonly<{
  apiUrl: string;
}>;

export function loadWebPublicConfig(
  input: Record<string, unknown>,
): WebPublicConfig {
  const parsed = webPublicConfigSchema.parse(input);
  return { apiUrl: parsed.NEXT_PUBLIC_API_URL };
}

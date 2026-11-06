import type { TemplateEconomics } from "@/components/launchpad/types";
import { activeChainId, apiRequest } from "@/lib/api-client";
import { webPublicConfig } from "@/config/public-env";

const CACHE_TTL_MS = 5 * 60 * 1_000;

type CachedEconomics = Readonly<{
  expiresAt: number;
  request: Promise<TemplateEconomics>;
}>;

const economicsCache = new Map<string, CachedEconomics>();

/**
 * Template economics are governed data. Sharing one short-lived request per
 * chain/template prevents launch surfaces from independently exhausting the
 * public API rate limit while keeping governance changes reasonably fresh.
 */
export function getTemplateEconomics(
  templateId: string,
): Promise<TemplateEconomics> {
  const chainId = activeChainId() ?? 4663;
  const key = `${chainId}:${templateId}`;
  const now = Date.now();
  const cached = economicsCache.get(key);
  if (cached && cached.expiresAt > now) return cached.request;

  const request = apiRequest<TemplateEconomics>(
    webPublicConfig.apiUrl,
    `/v1/dbc/templates/${encodeURIComponent(templateId)}/economics`,
  ).catch((error: unknown) => {
    economicsCache.delete(key);
    throw error;
  });

  economicsCache.set(key, { expiresAt: now + CACHE_TTL_MS, request });
  return request;
}

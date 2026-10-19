import { z } from "zod";

const classificationSchema = z
  .object({
    symbol: z.string().trim().min(1).max(32),
    region: z.enum(["us", "china"]),
    basis: z.string().trim().min(20).max(500),
    sourceUrl: z.string().url(),
    sourceKind: z.enum(["issuer", "issuer_filing"]),
    verifiedAt: z.string().date(),
  })
  .readonly();

export type StockMarketClassification = z.infer<typeof classificationSchema>;

const records = [
  {
    symbol: "AMD",
    region: "us",
    basis:
      "AMD identifies itself as a Delaware company headquartered in Santa Clara, California, United States.",
    sourceUrl: "https://www.amd.com/en/legal/privacy.html",
    sourceKind: "issuer",
    verifiedAt: "2026-10-18",
  },
  {
    symbol: "AMZN",
    region: "us",
    basis:
      "Amazon states that it is incorporated in Delaware and its principal corporate offices are in Seattle, Washington.",
    sourceUrl: "https://ir.aboutamazon.com/faqs/default.aspx",
    sourceKind: "issuer",
    verifiedAt: "2026-10-18",
  },
  {
    symbol: "NFLX",
    region: "us",
    basis:
      "Netflix's issuer filing identifies Netflix, Inc. as a Delaware corporation with principal executive offices in Los Gatos, California.",
    sourceUrl:
      "https://ir.netflix.net/financials/sec-filings/sec-filings-details/default.aspx?FilingId=18130423",
    sourceKind: "issuer_filing",
    verifiedAt: "2026-10-18",
  },
  {
    symbol: "PLTR",
    region: "us",
    basis:
      "Palantir's issuer notice identifies its current principal executive office in Aventura, Florida, United States.",
    sourceUrl:
      "https://investors.palantir.com/news-details/2026/Notice-of-Principal-Executive-Office-Address-Change-2/",
    sourceKind: "issuer",
    verifiedAt: "2026-10-18",
  },
  {
    symbol: "BABA",
    region: "china",
    basis:
      "Alibaba Group identifies the principal executive offices of its main operations in Hangzhou, Zhejiang, China.",
    sourceUrl: "https://www.alibabagroup.com/en-US/faqs-corporate-information",
    sourceKind: "issuer",
    verifiedAt: "2026-10-18",
  },
  {
    symbol: "FUTU",
    region: "china",
    basis:
      "Futu Holdings' annual issuer filing identifies its corporate headquarters in Hong Kong and material operations in Mainland China and Hong Kong.",
    sourceUrl:
      "https://ir.futuholdings.com/static-files/02a38af2-a156-4bf4-8472-6ab0ac1ac028",
    sourceKind: "issuer_filing",
    verifiedAt: "2026-10-18",
  },
  {
    symbol: "TSLA",
    region: "us",
    basis:
      "Tesla Investor Relations identifies Tesla, Inc.'s corporate headquarters in Austin, Texas, United States.",
    sourceUrl: "https://ir.tesla.com/contact-us",
    sourceKind: "issuer",
    verifiedAt: "2026-10-18",
  },
] satisfies StockMarketClassification[];

const classifications = new Map(
  records.map((record) => {
    const parsed = classificationSchema.parse(record);
    return [parsed.symbol, parsed] as const;
  }),
);

export function stockMarketClassification(symbol: string) {
  return classifications.get(symbol.trim().toUpperCase()) ?? null;
}

export function stockMarketClassifications() {
  return [...classifications.values()];
}

import { redirect } from "next/navigation";
import { legacyTradeUrl } from "@/lib/legacy-trade-url";

export default async function PoolDetailRedirect({ params }: { params: Promise<{ id: string }> }) {
  redirect(legacyTradeUrl({}, { mode: "liquidity", pool: (await params).id.toLowerCase() }));
}

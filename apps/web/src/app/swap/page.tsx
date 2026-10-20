import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { legacyTradeUrl } from "@/lib/legacy-trade-url";

export const metadata: Metadata = { title: "Swap" };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(legacyTradeUrl(await searchParams, { mode: "swap" }));
}

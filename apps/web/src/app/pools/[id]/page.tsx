import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pools, poolById } from "@/data/pools";
import { PoolDetail } from "./PoolDetail";

export function generateStaticParams() { return pools.map((p) => ({ id: p.id })); }

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const p = poolById((await params).id);
  return { title: p ? `${p.base}/${p.quote} ${p.type}` : "Pool" };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const pool = poolById((await params).id);
  if (!pool) notFound();
  return <PoolDetail id={pool.id} />;
}

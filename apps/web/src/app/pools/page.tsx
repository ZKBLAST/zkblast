import type { Metadata } from "next";
import { Suspense } from "react";
import { PoolsView } from "./PoolsView";

export const metadata: Metadata = { title: "Pools" };
export default function Page() {
  return <Suspense><PoolsView /></Suspense>;
}

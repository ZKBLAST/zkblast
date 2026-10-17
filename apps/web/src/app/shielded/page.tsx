import type { Metadata } from "next";
import { Suspense } from "react";
import { ShieldedView } from "./ShieldedView";

export const metadata: Metadata = { title: "Shielded vault" };
export default function Page() { return <Suspense><ShieldedView /></Suspense>; }

import type { Metadata } from "next";
import { Suspense } from "react";
import { Launchpad } from "@/components/launchpad/Launchpad";
import { Skeleton } from "@/components/ui/Skeleton";

export const metadata: Metadata = { title: "Launch" };
export default function LaunchPage() {
  return (
    <Suspense
      fallback={
        <main className="px-6 pt-[calc(var(--header-h)+2rem)]">
          <Skeleton className="h-[70vh] w-full" />
        </main>
      }
    >
      <Launchpad />
    </Suspense>
  );
}

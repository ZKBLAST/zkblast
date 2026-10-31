import type { Metadata } from "next";
import { Launchpad } from "@/components/launchpad/Launchpad";

export const metadata: Metadata = { title: "Launch" };
export default function LaunchPage() { return <Launchpad />; }

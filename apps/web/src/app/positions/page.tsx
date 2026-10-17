import type { Metadata } from "next";
import { PositionsView } from "./PositionsView";

export const metadata: Metadata = { title: "Positions" };
export default function Page() { return <PositionsView />; }

import type { Metadata } from "next";
import { DocsView } from "./DocsView";

export const metadata: Metadata = { title: "Docs" };
export default function Page() { return <DocsView />; }

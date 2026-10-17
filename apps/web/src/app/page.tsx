import { Hero } from "@/components/landing/Hero";
import { TerminalOverview } from "@/components/landing/TerminalOverview";
import { MarketsTable } from "@/components/landing/MarketsTable";
import { Lanes } from "@/components/landing/Lanes";
import { NoteJourney } from "@/components/landing/NoteJourney";
import { BinsShowcase } from "@/components/landing/BinsShowcase";
import { Disclosure } from "@/components/landing/Disclosure";
import { Roadmap } from "@/components/landing/Roadmap";
import { Modules } from "@/components/landing/Modules";
import { FinalCta } from "@/components/landing/FinalCta";

export default function Home() {
  return (
    <>
      <Hero />
      <TerminalOverview />
      <MarketsTable />
      <Lanes />
      <BinsShowcase />
      <NoteJourney />
      <Disclosure />
      <Roadmap />
      <Modules />
      <FinalCta />
    </>
  );
}

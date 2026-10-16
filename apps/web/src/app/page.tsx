import { NetworkBadge } from "@zkblast/ui";

export default function HomePage() {
  const environment = process.env.NEXT_PUBLIC_APP_ENV;

  return (
    <main>
      <header>
        <span className="wordmark">ZKBLAST</span>
        <NetworkBadge environment={environment} />
      </header>
      <section>
        <p className="eyebrow">ZERO-KNOWLEDGE LIQUIDITY INFRASTRUCTURE</p>
        <h1>Liquidity Without Exposure.</h1>
        <p className="lede">
          Public AMM and shielded testnet experiences will remain explicitly
          separated.
        </p>
      </section>
    </main>
  );
}

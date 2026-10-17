import developers from "../data/developers.json";
import type { PublicConfig } from "../types/application";
import { Badge, Panel } from "../components/ui/primitives";

export function DocsPage({
  config,
}: Readonly<{ config: PublicConfig | null }>) {
  return (
    <main className="page-container docs-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">ZKBLAST / DOCUMENTATION</span>
          <h1>Build against explicit boundaries.</h1>
          <p>
            Product architecture, integration guidance, execution lifecycle and
            delivery state.
          </p>
        </div>
        <Badge>
          {config
            ? `${config.environment.toUpperCase()} · ${config.chainId}`
            : "RUNTIME SYNC"}
        </Badge>
      </div>
      <nav className="docs-index">
        {[
          "Quick start",
          "Architecture",
          "Swap flow",
          "Liquidity",
          "Deployment",
          "Roadmap",
          "Safety",
        ].map((item) => (
          <a href={`#${item.toLowerCase().replace(" ", "-")}`} key={item}>
            {item}
          </a>
        ))}
      </nav>
      <section className="docs-section" id="quick-start">
        <div className="docs-section-title">
          <span>01</span>
          <div>
            <h2>Quick start</h2>
            <p>
              Select the environment once at deployment. The web talks to its
              configured API and never receives private infrastructure values.
            </p>
          </div>
        </div>
        <div className="three-column">
          <Panel>
            <small>NETWORK</small>
            <h3>{config?.chainName ?? "Selected by API"}</h3>
            <p>
              Chain ID: <code>{config?.chainId ?? "—"}</code>
            </p>
          </Panel>
          <Panel>
            <small>APPLICATION API</small>
            <h3>Single public origin</h3>
            <p>
              All session and protocol reads are routed through the server
              boundary.
            </p>
          </Panel>
          <Panel>
            <small>DATABASE</small>
            <h3>Schema isolated</h3>
            <p>Testnet and mainnet application data never share a schema.</p>
          </Panel>
        </div>
      </section>
      <section className="docs-section" id="architecture">
        <div className="docs-section-title">
          <span>02</span>
          <div>
            <h2>Architecture</h2>
            <p>
              UI state can move from fixtures to indexed contract data without
              changing the presentation layer.
            </p>
          </div>
        </div>
        <div className="architecture-flow">
          {developers.architecture.map((step, index) => (
            <div key={step}>
              <small>{String(index + 1).padStart(2, "0")}</small>
              <b>{step}</b>
              {index < developers.architecture.length - 1 && <span>→</span>}
            </div>
          ))}
        </div>
      </section>
      <section className="docs-section" id="swap-flow">
        <div className="docs-section-title">
          <span>03</span>
          <div>
            <h2>Swap lifecycle</h2>
            <p>
              Every state is visible: quote, slippage, approval, review, submit,
              receipt, index and recovery.
            </p>
          </div>
        </div>
        <div className="docs-flow">
          {[
            "Quote requested",
            "Route selected",
            "Allowance checked",
            "Approval signed",
            "Swap reviewed",
            "Transaction submitted",
            "Receipt confirmed",
            "History indexed",
          ].map((step, index) => (
            <div key={step}>
              <small>{String(index + 1).padStart(2, "0")}</small>
              <strong>{step}</strong>
            </div>
          ))}
        </div>
      </section>
      <section className="docs-section" id="liquidity">
        <div className="docs-section-title">
          <span>04</span>
          <div>
            <h2>Liquidity positions</h2>
            <p>
              DLMM ranges and DAMM full-range positions share a consistent
              create, adjust, collect and close workflow.
            </p>
          </div>
        </div>
        <div className="three-column">
          <Panel>
            <h3>Create</h3>
            <p>
              Select a pool, range, token amounts and fee strategy before
              review.
            </p>
          </Panel>
          <Panel>
            <h3>Manage</h3>
            <p>
              Track active range, position value, unclaimed fees and price
              movement.
            </p>
          </Panel>
          <Panel>
            <h3>Exit</h3>
            <p>
              Decrease liquidity, collect proceeds and index the finalized
              receipt.
            </p>
          </Panel>
        </div>
      </section>
      <section className="docs-section" id="deployment">
        <div className="docs-section-title">
          <span>05</span>
          <div>
            <h2>Deployment contract</h2>
            <p>
              Web, API, indexer and SDK consume the same environment-specific
              JSON manifest.
            </p>
          </div>
        </div>
        <Panel>
          <pre>
            <code>{`{\n  "environment": "${config?.environment ?? "testnet"}",\n  "chainId": ${config?.chainId ?? 46630},\n  "contracts": {\n    "router": { "proxy": "AWAITING_DEPLOYMENT" },\n    "factory": { "proxy": "AWAITING_DEPLOYMENT" }\n  },\n  "deployment": { "transactionHash": null, "gasUsed": null }\n}`}</code>
          </pre>
        </Panel>
      </section>
      <section className="docs-section" id="roadmap">
        <div className="docs-section-title">
          <span>06</span>
          <div>
            <h2>Product roadmap</h2>
            <p>
              Statuses reflect engineering state, not a claim of live
              deployment.
            </p>
          </div>
        </div>
        <div className="roadmap-grid">
          {developers.roadmap.map((item) => (
            <Panel key={item.title}>
              <Badge muted>{item.status}</Badge>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </Panel>
          ))}
        </div>
      </section>
      <section className="docs-section" id="safety">
        <div className="docs-section-title">
          <span>07</span>
          <div>
            <h2>Safety boundary</h2>
            <p>
              Frontend state is informational. Contracts independently enforce
              authorization, pricing, slippage, deadlines and upgrade controls.
            </p>
          </div>
        </div>
        <div className="disclosure">
          Private RPC endpoints, Supabase URLs and keys, direct database URLs,
          signer keys and administrative configuration are never included in the
          browser bundle or public documentation.
        </div>
      </section>
    </main>
  );
}

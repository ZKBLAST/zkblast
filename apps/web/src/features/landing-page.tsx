"use client";

import { useState } from "react";
import markets from "../data/markets.json";
import site from "../data/site.json";
import type { PublicConfig, UserProfile } from "../types/application";
import { MetricStrip } from "../components/protocol/metric-strip";
import { PoolTable } from "../components/protocol/pool-table";
import { AppLink, Panel } from "../components/ui/primitives";
import { shortAddress } from "../lib/format";

export function Landing({
  config,
  notice,
  connect,
  profile,
  busy,
}: Readonly<{
  config: PublicConfig | null;
  notice: string;
  connect: () => void;
  profile: UserProfile | null;
  busy: boolean;
}>) {
  const [openFaq, setOpenFaq] = useState(0);
  return (
    <main className="landing-page">
      <section className="hero">
        <div className="hero-shell">
          <aside className="hero-side hero-side-left">
            <div className="hero-side-heading">
              <span>PROTOCOL RACK</span>
              <small>PUBLIC AMM</small>
            </div>
            <div className="registry-rack">
              {site.protocols.map((item) => (
                <div className="registry-row" key={item.code}>
                  <b>{item.code}</b>
                  <span>{item.name}</span>
                  <em>{item.state}</em>
                </div>
              ))}
            </div>
            <div className="hero-side-footer">
              <i className="status-dot connected" />
              ENVIRONMENT BOUND
            </div>
          </aside>
          <div className="hero-core">
            <div className="hero-coordinate top-left">{site.hero.eyebrow}</div>
            <div className="hero-coordinate top-right">
              {config?.chainName.toUpperCase() ?? "NETWORK SYNC"}
            </div>
            <div className="hero-stage">
              <div className="hero-bezel">
                <i className="screw tl" />
                <i className="screw tr" />
                <i className="screw bl" />
                <i className="screw br" />
                <div className="hero-headline-panel">
                  <h1>
                    {site.hero.lines.map((line, index) =>
                      index === 1 ? (
                        <strong key={line}>{line}</strong>
                      ) : (
                        <span key={line}>{line}</span>
                      ),
                    )}
                  </h1>
                </div>
                <div className="hero-description-panel">
                  <p>{site.hero.description}</p>
                </div>
              </div>
              <div className="instrument-lines" aria-hidden="true">
                {Array.from({ length: 45 }, (_, index) => (
                  <i key={index} />
                ))}
              </div>
              <div className="hero-cta-bezel">
                <AppLink className="button button-secondary" href="/pools">
                  {site.hero.secondary}
                </AppLink>
                <AppLink className="button button-primary" href="/trade">
                  {site.hero.primary} →
                </AppLink>
              </div>
              <div className="hero-subline">
                <span>DLMM</span>
                <i />
                <span>DAMM</span>
                <i />
                <span>SHIELDED TESTNET</span>
              </div>
              <p className="hero-notice">{notice}</p>
            </div>
          </div>
          <aside className="hero-side hero-side-right">
            <div className="hero-side-heading">
              <span>NETWORK TERMINAL</span>
              <small>{config?.environment.toUpperCase() ?? "SYNC"}</small>
            </div>
            <div className="terminal-stream">
              <div className="terminal-head">
                <span>SYSTEM</span>
                <span>DETAIL</span>
                <span>STATE</span>
              </div>
              <div className="terminal-row">
                <b>API</b>
                <span>{config ? `CHAIN ${config.chainId}` : "CONNECTING"}</span>
                <em>{config ? "ONLINE" : "WAIT"}</em>
              </div>
              <div className="terminal-row">
                <b>SESSION</b>
                <span>
                  {profile
                    ? (profile.username ?? "VERIFIED WALLET")
                    : "NO ACTIVE SESSION"}
                </span>
                <em>{profile ? "SIGNED" : "STANDBY"}</em>
              </div>
              <div className="terminal-row">
                <b>MARKETS</b>
                <span>{markets.pools.length} DEMO POOLS</span>
                <em>PREVIEW</em>
              </div>
            </div>
            <button
              className="terminal-connect"
              disabled={busy}
              onClick={connect}
            >
              {profile
                ? shortAddress(profile.wallets[0]?.address ?? "")
                : busy
                  ? "CONNECTING…"
                  : "CONNECT WALLET →"}
            </button>
            <div className="hero-side-footer">
              <i className={`status-dot ${config ? "connected" : ""}`} />
              SECURE API BOUNDARY
            </div>
          </aside>
        </div>
      </section>
      <MetricStrip />
      <section className="chapter-section">
        <div className="section-index">01 / PROTOCOL SYSTEM</div>
        <div className="chapter-heading">
          <h2>
            One liquidity layer.
            <br />
            Multiple execution models.
          </h2>
          <p>
            ZKBLAST separates public liquidity execution, environment
            configuration and future privacy research into explicit, auditable
            surfaces.
          </p>
        </div>
        <div className="feature-grid">
          {site.features.map((item) => (
            <Panel key={item.step}>
              <small>{item.step}</small>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </Panel>
          ))}
        </div>
      </section>
      <section className="market-preview">
        <div className="section-index">02 / LIQUIDITY DIRECTORY</div>
        <div className="page-title-row">
          <div>
            <h2>Markets engineered for flow.</h2>
            <p>
              Representative interface data. No deployment or liquidity claim is
              implied.
            </p>
          </div>
          <AppLink className="text-link" href="/pools">
            VIEW ALL POOLS →
          </AppLink>
        </div>
        <PoolTable compact />
      </section>
      <section className="pipeline-section">
        <div className="section-index">03 / EXECUTION FLOW</div>
        <div className="pipeline">
          {["Connect", "Quote", "Approve", "Execute", "Index", "Reconcile"].map(
            (step, index) => (
              <div key={step}>
                <small>0{index + 1}</small>
                <strong>{step}</strong>
                {index < 5 && <span>→</span>}
              </div>
            ),
          )}
        </div>
      </section>
      <section className="faq-section" id="faq">
        <div className="section-index">04 / OPERATING BOUNDARY</div>
        <div className="faq-layout">
          <h2>
            Understand the
            <br />
            system.
          </h2>
          <div>
            {site.faqs.map((item, index) => (
              <button
                className={`faq-item${openFaq === index ? " open" : ""}`}
                key={item.question}
                onClick={() => setOpenFaq(index)}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{item.question}</strong>
                <em>{openFaq === index ? "−" : "+"}</em>
                {openFaq === index && <p>{item.answer}</p>}
              </button>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

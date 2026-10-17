"use client";

import { useState } from "react";
import developers from "../data/developers.json";
import { Badge, Panel } from "../components/ui/primitives";

export function DevelopersPage({ apiUrl }: Readonly<{ apiUrl: string }>) {
  const [selected, setSelected] = useState<
    (typeof developers.endpoints)[number]
  >(developers.endpoints[0]!);
  const response = JSON.stringify(
    {
      environment: "selected by API",
      endpoint: selected.path,
      note: "Live request is only made by the product flow that requires it.",
    },
    null,
    2,
  );
  return (
    <main className="page-container">
      <div className="page-heading">
        <div>
          <span className="eyebrow">ZKBLAST / DEVELOPER INTERFACE</span>
          <h1>Integrate one environment boundary.</h1>
          <p>
            The browser receives one API origin. RPC, database and service
            credentials stay server-side.
          </p>
        </div>
        <Badge>API {apiUrl.replace(/^https?:\/\//, "")}</Badge>
      </div>
      <div className="developer-layout">
        <aside className="endpoint-nav">
          <h3>API REFERENCE</h3>
          {developers.endpoints.map((endpoint) => (
            <button
              className={selected.path === endpoint.path ? "active" : ""}
              key={endpoint.path}
              onClick={() => setSelected(endpoint)}
            >
              <span>{endpoint.method}</span>
              {endpoint.path}
            </button>
          ))}
        </aside>
        <section>
          <Panel className="endpoint-card">
            <div className="endpoint-title">
              <Badge>{selected.method}</Badge>
              <h2>{selected.path}</h2>
            </div>
            <p>{selected.description}</p>
            <pre>
              <code>{response}</code>
            </pre>
          </Panel>
          <div className="two-column">
            <Panel>
              <div className="panel-title">
                <h2>Quick start</h2>
              </div>
              <pre>
                <code>{developers.quickstart}</code>
              </pre>
            </Panel>
            <Panel>
              <div className="panel-title">
                <h2>Manifest-driven contracts</h2>
              </div>
              <pre>
                <code>{developers.contractExample}</code>
              </pre>
            </Panel>
          </div>
        </section>
      </div>
      <section className="architecture">
        <div className="section-index">REQUEST PATH</div>
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
    </main>
  );
}

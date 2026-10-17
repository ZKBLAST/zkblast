"use client";

import { type FormEvent, useEffect, useState } from "react";
import type { Trade, UserProfile } from "../types/application";
import { shortAddress } from "../lib/format";
import { apiRequest } from "../lib/api-client";
import { Badge, Panel } from "../components/ui/primitives";

export function PortfolioPage({
  profile,
  trades,
  username,
  setUsername,
  saveUsername,
  connect,
  logout,
  busy,
  apiUrl,
}: Readonly<{
  profile: UserProfile | null;
  trades: readonly Trade[];
  username: string;
  setUsername: (value: string) => void;
  saveUsername: (event: FormEvent<HTMLFormElement>) => void;
  connect: () => void;
  logout: () => void;
  busy: boolean;
  apiUrl: string;
}>) {
  const [positions, setPositions] = useState<
    readonly Readonly<{
      positionId: string;
      poolAddress?: string;
      model?: string;
      shares?: string;
      status?: string;
    }>[]
  >([]);
  useEffect(() => {
    if (!profile) {
      setPositions([]);
      return;
    }
    void apiRequest<{ items: typeof positions }>(
      apiUrl,
      "/v1/protocol/positions?limit=100",
    )
      .then(({ items }) => setPositions(items))
      .catch(() => setPositions([]));
  }, [apiUrl, profile]);
  return (
    <main className="page-container">
      <div className="page-heading">
        <div>
          <span className="eyebrow">ZKBLAST / ACCOUNT TERMINAL</span>
          <h1>Your liquidity command center.</h1>
          <p>
            Identity, positions and transaction history remain scoped to the
            verified wallet session.
          </p>
        </div>
        <Badge>{profile ? "SESSION VERIFIED" : "WALLET REQUIRED"}</Badge>
      </div>
      {!profile ? (
        <Panel className="connect-state">
          <span className="brand-mark large">ZK</span>
          <h2>Connect to load your portfolio</h2>
          <p>
            The API verifies a wallet signature and stores the session in a
            secure HttpOnly cookie.
          </p>
          <button
            className="button button-primary"
            disabled={busy}
            onClick={connect}
          >
            CONNECT WALLET
          </button>
        </Panel>
      ) : (
        <>
          <div className="account-strip">
            <div>
              <small>USER</small>
              <strong>{profile.username ?? "UNNAMED"}</strong>
            </div>
            <div>
              <small>PRIMARY WALLET</small>
              <strong>{shortAddress(profile.wallets[0]?.address ?? "")}</strong>
            </div>
            <div>
              <small>LOGINS</small>
              <strong>{profile.loginCount}</strong>
            </div>
            <button className="button button-secondary" onClick={logout}>
              DISCONNECT
            </button>
          </div>
          <div className="portfolio-grid">
            <Panel>
              <div className="panel-title">
                <h2>Identity settings</h2>
              </div>
              <form onSubmit={saveUsername}>
                <label className="entry-field">
                  USERNAME
                  <input
                    minLength={3}
                    maxLength={24}
                    pattern="[A-Za-z0-9_]+"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    required
                  />
                </label>
                <button
                  className="button button-primary full-width"
                  disabled={busy}
                >
                  SAVE USERNAME
                </button>
              </form>
            </Panel>
            <Panel className="positions-panel">
              <div className="panel-title">
                <h2>Indexed positions</h2>
                <Badge>{positions.length} ONCHAIN</Badge>
              </div>
              {positions.map((position) => (
                <div className="position-row" key={position.positionId}>
                  <div>
                    <b>POSITION #{position.positionId}</b>
                    <small>
                      {position.model?.toUpperCase() ?? "POOL POSITION"}
                    </small>
                  </div>
                  <div>
                    <b>{position.shares ?? "—"} SHARES</b>
                    <small>{shortAddress(position.poolAddress ?? "")}</small>
                  </div>
                  <div>
                    <span>{position.status ?? "ACTIVE"}</span>
                    <small>INDEXER VERIFIED</small>
                  </div>
                </div>
              ))}
              {!positions.length && (
                <div className="empty-state">
                  No indexed positions for this environment yet.
                </div>
              )}
            </Panel>
          </div>
          <Panel className="history-panel">
            <div className="panel-title">
              <h2>Verified trade history</h2>
              <span>{trades.length} RECORDS</span>
            </div>
            {trades.length ? (
              trades.map((trade) => (
                <div className="history-row" key={trade.id}>
                  <b>{trade.action.replaceAll("_", " ")}</b>
                  <span>{trade.venue}</span>
                  <span>{trade.status}</span>
                  <span>{new Date(trade.submittedAt).toLocaleString()}</span>
                  <code>
                    {trade.transactionHash
                      ? shortAddress(trade.transactionHash)
                      : "PENDING"}
                  </code>
                </div>
              ))
            ) : (
              <div className="empty-state">
                No verified onchain activity has been indexed for this account.
              </div>
            )}
          </Panel>
        </>
      )}
    </main>
  );
}

"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";

type EthereumProvider = Readonly<{
  request(
    input: Readonly<{ method: string; params?: unknown[] }>,
  ): Promise<unknown>;
}>;

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

type PublicConfig = Readonly<{
  environment: "testnet" | "mainnet";
  chainId: number;
  chainName: string;
  explorerUrl: string;
}>;
type UserProfile = Readonly<{
  id: string;
  username: string | null;
  loginCount: number;
  lastLoginAt: string | null;
  wallets: readonly Readonly<{ address: string; isPrimary: boolean }>[];
}>;
type Trade = Readonly<{
  id: string;
  action: string;
  status: string;
  transactionHash: string | null;
  venue: string;
  submittedAt: string;
}>;

async function apiRequest<T>(
  apiUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string };
    } | null;
    throw new Error(payload?.error?.code ?? `HTTP_${response.status}`);
  }
  return (response.status === 204 ? null : response.json()) as Promise<T>;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function Dashboard({ apiUrl }: Readonly<{ apiUrl: string }>) {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [trades, setTrades] = useState<readonly Trade[]>([]);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("Checking secure session…");

  const loadAccount = useCallback(async () => {
    try {
      const [nextProfile, history] = await Promise.all([
        apiRequest<UserProfile>(apiUrl, "/v1/me"),
        apiRequest<{ items: Trade[] }>(apiUrl, "/v1/me/trades?limit=25"),
      ]);
      setProfile(nextProfile);
      setUsername(nextProfile.username ?? "");
      setTrades(history.items);
      setNotice("Session secured by the ZKBLAST API");
    } catch {
      setProfile(null);
      setTrades([]);
      setNotice("Connect a wallet to create or resume your account");
    }
  }, [apiUrl]);

  useEffect(() => {
    void Promise.all([
      apiRequest<PublicConfig>(apiUrl, "/v1/config").then(setConfig),
      loadAccount(),
    ]).catch(() => setNotice("API is currently unavailable"));
  }, [apiUrl, loadAccount]);

  async function connectWallet() {
    if (!window.ethereum) {
      setNotice("Install an EVM wallet extension to continue");
      return;
    }
    setBusy(true);
    try {
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      const walletAddress = accounts[0];
      if (!walletAddress) throw new Error("WALLET_ACCOUNT_MISSING");
      const network =
        config ?? (await apiRequest<PublicConfig>(apiUrl, "/v1/config"));
      const walletChain = (await window.ethereum.request({
        method: "eth_chainId",
      })) as string;
      if (Number.parseInt(walletChain, 16) !== network.chainId) {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: `0x${network.chainId.toString(16)}` }],
        });
      }
      const challenge = await apiRequest<{
        challengeId: string;
        message: string;
      }>(apiUrl, "/v1/auth/challenge", {
        method: "POST",
        body: JSON.stringify({ walletAddress }),
      });
      const signature = (await window.ethereum.request({
        method: "personal_sign",
        params: [challenge.message, walletAddress],
      })) as string;
      await apiRequest(apiUrl, "/v1/auth/verify", {
        method: "POST",
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          walletAddress,
          message: challenge.message,
          signature,
        }),
      });
      await loadAccount();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Wallet login failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveUsername(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await apiRequest(apiUrl, "/v1/me/username", {
        method: "PATCH",
        body: JSON.stringify({ username }),
      });
      await loadAccount();
      setNotice("Username updated");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await apiRequest(apiUrl, "/v1/auth/logout", { method: "POST" });
      setProfile(null);
      setTrades([]);
      setNotice("Session closed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <div>
          <span className="wordmark">ZKBLAST</span>
          <span className="network-pill">
            {config
              ? `${config.chainName} · ${config.environment}`
              : "API SYNC"}
          </span>
        </div>
        {profile ? (
          <button
            className="button button-ghost"
            disabled={busy}
            onClick={() => void logout()}
          >
            Disconnect
          </button>
        ) : (
          <button
            className="button"
            disabled={busy}
            onClick={() => void connectWallet()}
          >
            {busy ? "Waiting for wallet…" : "Connect wallet"}
          </button>
        )}
      </header>
      <section className="hero">
        <p className="eyebrow">ZERO-KNOWLEDGE LIQUIDITY INFRASTRUCTURE</p>
        <h1>Liquidity Without Exposure.</h1>
        <p className="lede">{notice}</p>
      </section>
      {profile ? (
        <section className="dashboard-grid">
          <article className="panel profile-panel">
            <p className="panel-label">IDENTITY</p>
            <h2>{profile.username ?? "Choose your username"}</h2>
            <p className="wallet-address">
              {profile.wallets[0]
                ? shortAddress(profile.wallets[0].address)
                : "No verified wallet"}
            </p>
            <form onSubmit={(event) => void saveUsername(event)}>
              <label htmlFor="username">Username</label>
              <div className="input-row">
                <input
                  id="username"
                  minLength={3}
                  maxLength={24}
                  pattern="[A-Za-z0-9_]+"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="zkblast_user"
                  required
                />
                <button className="button" disabled={busy} type="submit">
                  Save
                </button>
              </div>
            </form>
            <dl className="metrics">
              <div>
                <dt>Logins</dt>
                <dd>{profile.loginCount}</dd>
              </div>
              <div>
                <dt>Wallets</dt>
                <dd>{profile.wallets.length}</dd>
              </div>
            </dl>
          </article>
          <article className="panel trade-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-label">ACTIVITY</p>
                <h2>Trade history</h2>
              </div>
              <span>{trades.length} records</span>
            </div>
            {trades.length === 0 ? (
              <div className="empty-state">
                Your verified onchain activity will appear here.
              </div>
            ) : (
              <div
                className="trade-table"
                role="table"
                aria-label="Trade history"
              >
                {trades.map((trade) => (
                  <div className="trade-row" role="row" key={trade.id}>
                    <div>
                      <strong>{trade.action.replaceAll("_", " ")}</strong>
                      <span>{trade.venue}</span>
                    </div>
                    <div>
                      <strong>{trade.status}</strong>
                      <span>
                        {new Date(trade.submittedAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="tx-cell">
                      {trade.transactionHash
                        ? shortAddress(trade.transactionHash)
                        : "Pending"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>
        </section>
      ) : null}
    </>
  );
}

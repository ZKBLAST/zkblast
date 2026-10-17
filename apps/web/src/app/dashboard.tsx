"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import site from "../data/site.json";
import { AppLink } from "../components/ui/primitives";
import { DevelopersPage } from "../features/developers-page";
import { DocsPage } from "../features/docs-page";
import { ExplorerPage } from "../features/explorer-page";
import { Landing } from "../features/landing-page";
import { PoolsPage } from "../features/pools-page";
import { PortfolioPage } from "../features/portfolio-page";
import { SwapPage } from "../features/swap-page";
import { apiRequest } from "../lib/api-client";
import { shortAddress } from "../lib/format";
import type { PublicConfig, Trade, UserProfile } from "../types/application";

type AccountState = Readonly<{
  profile: UserProfile | null;
  trades: readonly Trade[];
}>;

const emptyAccount: AccountState = { profile: null, trades: [] };

export function Dashboard({ apiUrl }: Readonly<{ apiUrl: string }>) {
  const pathname = usePathname();
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [account, setAccount] = useState<AccountState>(emptyAccount);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("Checking secure session…");

  const loadAccount = useCallback(async () => {
    try {
      const [profile, history] = await Promise.all([
        apiRequest<UserProfile>(apiUrl, "/v1/me"),
        apiRequest<{ items: Trade[] }>(apiUrl, "/v1/me/trades?limit=25"),
      ]);
      setAccount({ profile, trades: history.items });
      setUsername(profile.username ?? "");
      setNotice("Session secured by the ZKBLAST API");
    } catch {
      setAccount(emptyAccount);
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
        body: JSON.stringify({ ...challenge, walletAddress, signature }),
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
      setAccount(emptyAccount);
      setNotice("Session closed");
    } finally {
      setBusy(false);
    }
  }

  const connect = () => void connectWallet();
  const disconnect = () => void logout();
  const page = selectPage({
    pathname,
    apiUrl,
    config,
    account,
    username,
    setUsername,
    busy,
    notice,
    connect,
    disconnect,
    saveUsername: (event) => void saveUsername(event),
  });

  return (
    <div className="application">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <header className="site-header">
        <AppLink className="brand" href="/">
          <span className="brand-mark">ZK</span>
          <span>
            {site.name}
            <small>LIQUIDITY PROTOCOL</small>
          </span>
        </AppLink>
        <nav className="primary-navigation">
          {site.navigation.map((item) => (
            <AppLink
              className={
                pathname === item.href || pathname.startsWith(`${item.href}/`)
                  ? "active"
                  : ""
              }
              href={item.href}
              key={item.href}
            >
              {item.label.toUpperCase()}
            </AppLink>
          ))}
        </nav>
        <button
          className={`network-pill ${config ? "online" : ""}`}
          type="button"
        >
          <i />
          {config?.environment.toUpperCase() ?? "SYNC"} ·{" "}
          {config?.chainId ?? "—"}
        </button>
        <button
          className="button button-primary launch-button"
          disabled={busy}
          onClick={account.profile ? disconnect : connect}
        >
          {account.profile
            ? shortAddress(account.profile.wallets[0]?.address ?? "")
            : busy
              ? "CONNECTING…"
              : "CONNECT WALLET"}
        </button>
      </header>
      <div id="content">{page}</div>
      <footer>
        <div>
          <span className="brand-mark">ZK</span>
          <strong>ZKBLAST</strong>
          <p>{site.tagline}</p>
        </div>
        <nav>
          {site.navigation.map((item) => (
            <AppLink href={item.href} key={item.href}>
              {item.label}
            </AppLink>
          ))}
        </nav>
        <small>DEMO UI · ENVIRONMENT ISOLATED · 2026</small>
      </footer>
    </div>
  );
}

type PageContext = Readonly<{
  pathname: string;
  apiUrl: string;
  config: PublicConfig | null;
  account: AccountState;
  username: string;
  setUsername: (value: string) => void;
  busy: boolean;
  notice: string;
  connect: () => void;
  disconnect: () => void;
  saveUsername: (event: FormEvent<HTMLFormElement>) => void;
}>;

function selectPage(context: PageContext) {
  const [section, detail] = context.pathname.split("/").filter(Boolean);
  switch (section) {
    case "trade":
      return (
        <SwapPage
          connect={context.connect}
          profile={context.account.profile}
          apiUrl={context.apiUrl}
          config={context.config}
        />
      );
    case "pools":
      return (
        <PoolsPage
          poolId={detail}
          apiUrl={context.apiUrl}
          config={context.config}
          profile={context.account.profile}
          connect={context.connect}
        />
      );
    case "portfolio":
      return (
        <PortfolioPage
          profile={context.account.profile}
          trades={context.account.trades}
          username={context.username}
          setUsername={context.setUsername}
          saveUsername={context.saveUsername}
          connect={context.connect}
          logout={context.disconnect}
          busy={context.busy}
          apiUrl={context.apiUrl}
        />
      );
    case "explorer":
      return <ExplorerPage />;
    case "developers":
      return <DevelopersPage apiUrl={context.apiUrl} />;
    case "docs":
      return <DocsPage config={context.config} />;
    default:
      return (
        <Landing
          config={context.config}
          notice={context.notice}
          connect={context.connect}
          profile={context.account.profile}
          busy={context.busy}
        />
      );
  }
}

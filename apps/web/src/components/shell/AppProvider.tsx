"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, CircleAlert, Info, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { webPublicConfig } from "@/config/public-env";
import { apiRequest } from "@/lib/api-client";
import { parsePublicConfig } from "@/lib/network-config";
import { createWalletVerifyPayload } from "@/lib/wallet-auth";
import { ensureWalletChain } from "@/lib/wallet-network";
import type {
  ChainCatalogItem,
  PublicConfig,
  Trade,
  UserProfile,
} from "@/types/application";
import { WalletModal } from "./WalletModal";
import { TransactionSuccessModal } from "./TransactionSuccessModal";

type Toast = Readonly<{
  id: number;
  kind: "success" | "error" | "info";
  title: string;
  body?: string;
}>;
type AppContextValue = Readonly<{
  address: string | null;
  injectedAddress: string | null;
  walletChainId: number | null;
  config: PublicConfig | null;
  chains: readonly ChainCatalogItem[];
  profile: UserProfile | null;
  trades: readonly Trade[];
  busy: boolean;
  status: string;
  /** Compatibility state for preserved, disabled reference controls. Never represents on-chain balances. */
  balances: Readonly<Record<string, number>>;
  adjust: (_symbol: string, _delta: number) => void;
  connect: () => void;
  loginInjected: () => Promise<void>;
  switchNetwork: () => Promise<void>;
  selectChain: (chainId: number) => Promise<void>;
  openWallet: () => void;
  disconnect: () => Promise<void>;
  updateUsername: (username: string) => Promise<void>;
  refreshAccount: () => Promise<void>;
  toast: (toast: Omit<Toast, "id">) => void;
}>;

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used within AppProvider");
  return value;
}

export function AppProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [trades, setTrades] = useState<readonly Trade[]>([]);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [chains, setChains] = useState<readonly ChainCatalogItem[]>([]);
  const [walletOpen, setWalletOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Connecting to the ZKBLAST API");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [injectedAddress, setInjectedAddress] = useState<string | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const apiUrl = webPublicConfig.apiUrl;
  const address = profile?.wallets[0]?.address ?? null;

  const toast = useCallback((next: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current.slice(-2), { ...next, id }]);
    window.setTimeout(
      () => setToasts((current) => current.filter((item) => item.id !== id)),
      4_800,
    );
  }, []);

  const refreshAccount = useCallback(async () => {
    try {
      const session = await apiRequest<{
        authenticated: boolean;
        profile?: UserProfile;
        trades?: { items: Trade[] };
      }>("", "/auth-session");
      if (session.authenticated && session.profile && session.trades) {
        setProfile(session.profile);
        setTrades(session.trades.items);
        setStatus("Authenticated session active");
      } else {
        setProfile(null);
        setTrades([]);
        setStatus("Connect a wallet to sign in");
      }
    } catch {
      setProfile(null);
      setTrades([]);
      setStatus("Connect a wallet to sign in");
    }
  }, [apiUrl]);

  useEffect(() => {
    void (async () => {
      try {
        const [catalog, defaultConfig] = await Promise.all([
          apiRequest<{ chains: ChainCatalogItem[] }>(apiUrl, "/v2/chains"),
          apiRequest<unknown>(apiUrl, "/v1/config"),
          refreshAccount(),
        ]);
        setChains(catalog.chains);
        const fallback = parsePublicConfig(defaultConfig);
        const storedChainId = Number.parseInt(
          window.localStorage.getItem("zkblast.activeChainId") ?? "",
          10,
        );
        const storedChain = catalog.chains.find(
          (chain) => chain.chainId === storedChainId && chain.configured,
        );
        if (!storedChain || storedChain.chainId === fallback.chainId) {
          setConfig(fallback);
          return;
        }
        const selected = await apiRequest<unknown>(
          apiUrl,
          `/v2/chains/${storedChain.chainId}/config`,
        );
        setConfig(parsePublicConfig(selected));
      } catch {
        setStatus("ZKBLAST API is unavailable");
      }
    })();
  }, [apiUrl, refreshAccount]);

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider) return;
    const chainEvents = provider as unknown as {
      on?: (event: string, listener: (value: unknown) => void) => void;
      removeListener?: (
        event: string,
        listener: (value: unknown) => void,
      ) => void;
    };

    const syncInjectedAccount = (accounts: unknown) => {
      const walletAddress =
        Array.isArray(accounts) && typeof accounts[0] === "string"
          ? accounts[0]
          : null;
      setInjectedAddress(walletAddress);
    };
    const syncChain = (chainId: unknown) => {
      setWalletChainId(
        typeof chainId === "string" ? Number.parseInt(chainId, 16) : null,
      );
    };
    void provider
      .request({ method: "eth_accounts" })
      .then(syncInjectedAccount)
      .catch(() => setInjectedAddress(null));
    void provider
      .request({ method: "eth_chainId" })
      .then(syncChain)
      .catch(() => setWalletChainId(null));
    provider.on?.("accountsChanged", syncInjectedAccount);
    chainEvents.on?.("chainChanged", syncChain);

    return () => {
      provider.removeListener?.("accountsChanged", syncInjectedAccount);
      chainEvents.removeListener?.("chainChanged", syncChain);
    };
  }, []);

  const switchNetwork = useCallback(async () => {
    if (!window.ethereum) {
      setWalletOpen(true);
      return;
    }
    const activeConfig =
      config ??
      parsePublicConfig(await apiRequest<unknown>(apiUrl, "/v1/config"));
    const target = chains.find((chain) => chain.chainId === activeConfig.chainId);
    if (!target) throw new Error("CHAIN_CATALOG_MISSING");
    await ensureWalletChain(window.ethereum, target);
    setWalletChainId(activeConfig.chainId);
  }, [apiUrl, chains, config]);

  const selectChain = useCallback(
    async (chainId: number) => {
      const target = chains.find(
        (chain) => chain.chainId === chainId && chain.configured,
      );
      if (!target) throw new Error("CHAIN_NOT_CONFIGURED");
      setBusy(true);
      try {
        const selected = parsePublicConfig(
          await apiRequest<unknown>(apiUrl, `/v2/chains/${chainId}/config`),
        );
        if (window.ethereum) {
          await ensureWalletChain(window.ethereum, target);
          setWalletChainId(chainId);
        }
        window.localStorage.setItem("zkblast.activeChainId", String(chainId));
        setConfig(selected);
        setStatus(`${selected.chainName} selected`);
        toast({
          kind: "success",
          title: "Network changed",
          body: `${selected.chainName} · chain ${selected.chainId}`,
        });
      } catch (error) {
        toast({
          kind: "error",
          title: "Network change failed",
          body: error instanceof Error ? error.message : "Request rejected",
        });
        throw error;
      } finally {
        setBusy(false);
      }
    },
    [apiUrl, chains, toast],
  );

  const loginInjected = useCallback(async () => {
    if (!window.ethereum) {
      toast({
        kind: "error",
        title: "Wallet extension not detected",
        body: "Install an EVM browser wallet and try again.",
      });
      return;
    }
    setBusy(true);
    try {
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      const walletAddress = accounts[0];
      if (!walletAddress) throw new Error("WALLET_ACCOUNT_MISSING");
      setInjectedAddress(walletAddress);
      const activeConfig =
        config ??
        parsePublicConfig(await apiRequest<unknown>(apiUrl, "/v1/config"));
      const walletChain = (await window.ethereum.request({
        method: "eth_chainId",
      })) as string;
      if (Number.parseInt(walletChain, 16) !== activeConfig.chainId) {
        const target = chains.find(
          (chain) => chain.chainId === activeConfig.chainId,
        );
        if (!target) throw new Error("CHAIN_CATALOG_MISSING");
        await ensureWalletChain(window.ethereum, target);
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
        body: JSON.stringify(
          createWalletVerifyPayload(challenge, walletAddress, signature),
        ),
      });
      await refreshAccount();
      setWalletOpen(false);
      toast({
        kind: "success",
        title: "Wallet connected",
        body: `Signed in on ${activeConfig.chainName}`,
      });
    } catch (error) {
      toast({
        kind: "error",
        title: "Wallet login failed",
        body: error instanceof Error ? error.message : "Request rejected",
      });
    } finally {
      setBusy(false);
    }
  }, [apiUrl, chains, config, refreshAccount, toast]);

  const disconnect = useCallback(async () => {
    setBusy(true);
    let walletPermissionRevoked = false;
    try {
      await apiRequest(apiUrl, "/v1/auth/logout", { method: "POST" }).catch(
        () => undefined,
      );
      if (window.ethereum) {
        walletPermissionRevoked = await window.ethereum
          .request({
            method: "wallet_revokePermissions",
            params: [{ eth_accounts: {} }],
          })
          .then(() => true)
          .catch(() => false);
      }
      setProfile(null);
      setTrades([]);
      setInjectedAddress(null);
      setWalletChainId(null);
      setStatus("Session closed");
      toast({
        kind: "info",
        title: "Wallet disconnected",
        body: walletPermissionRevoked
          ? "The ZKBLAST session and wallet permission were removed."
          : "The ZKBLAST session was removed. This wallet does not support permission revocation; disconnect the site from the extension if needed.",
      });
    } finally {
      setBusy(false);
    }
  }, [apiUrl, toast]);

  const updateUsername = useCallback(
    async (username: string) => {
      await apiRequest(apiUrl, "/v1/me/username", {
        method: "PATCH",
        body: JSON.stringify({ username }),
      });
      await refreshAccount();
      toast({ kind: "success", title: "Username updated" });
    },
    [apiUrl, refreshAccount, toast],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      address,
      config,
      chains,
      profile,
      trades,
      busy,
      status,
      injectedAddress,
      walletChainId,
      balances: {},
      adjust: () => undefined,
      connect: () => setWalletOpen(true),
      loginInjected,
      switchNetwork,
      selectChain,
      openWallet: () => setWalletOpen(true),
      disconnect,
      updateUsername,
      refreshAccount,
      toast,
    }),
    [
      address,
      busy,
      config,
      chains,
      disconnect,
      loginInjected,
      profile,
      refreshAccount,
      status,
      injectedAddress,
      walletChainId,
      switchNetwork,
      selectChain,
      toast,
      trades,
      updateUsername,
    ],
  );

  return (
    <AppContext.Provider value={value}>
      {children}
      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
      <TransactionSuccessModal config={config} />
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[120] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-6 sm:items-end"
      >
        <AnimatePresence initial={false}>
          {toasts.map((item) => (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
              className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-md border border-line-strong bg-raised px-4 py-3 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.9)]"
            >
              {item.kind === "success" ? (
                <Check className="mt-0.5 size-4 shrink-0 text-lime" />
              ) : item.kind === "error" ? (
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
              ) : (
                <Info className="mt-0.5 size-4 shrink-0 text-muted" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{item.title}</p>
                {item.body && (
                  <p className="mt-0.5 text-[13px] text-muted">{item.body}</p>
                )}
              </div>
              <button
                aria-label="Dismiss notification"
                onClick={() =>
                  setToasts((current) =>
                    current.filter((toastItem) => toastItem.id !== item.id),
                  )
                }
                className="-m-1 grid size-7 cursor-pointer place-items-center rounded-xs text-faint hover:text-fg"
              >
                <X className="size-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </AppContext.Provider>
  );
}

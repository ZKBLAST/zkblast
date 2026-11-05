import assert from "node:assert/strict";
import test from "node:test";
import { ensureWalletChain } from "../src/lib/wallet-network.js";

const elysium = {
  chainId: 99_801,
  name: "Elysium Testnet",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 as const },
  explorerUrl: "https://elysium.kinetiq.xyz/testnet-explorer",
};

test("adds Elysium with its public RPC before switching an unknown wallet chain", async () => {
  const calls: { method: string; params?: unknown[] }[] = [];
  let switchAttempts = 0;
  const provider = {
    async request(input: { method: string; params?: unknown[] }) {
      calls.push(input);
      if (input.method === "wallet_switchEthereumChain" && switchAttempts++ === 0) {
        throw Object.assign(new Error("unknown chain"), { code: 4_902 });
      }
      if (input.method === "eth_chainId") return "0x185d9";
      return null;
    },
  };

  await ensureWalletChain(provider, elysium);
  assert.deepEqual(calls.map((call) => call.method), [
    "wallet_switchEthereumChain",
    "wallet_addEthereumChain",
    "wallet_switchEthereumChain",
    "eth_chainId",
  ]);
  const added = (calls[1]?.params?.[0] ?? {}) as { rpcUrls?: string[] };
  assert.deepEqual(added.rpcUrls, ["https://testnet-rpc.elysium.kinetiq.xyz"]);
});

test("rejects when the wallet reports a different chain after switching", async () => {
  const provider = {
    async request(input: { method: string }) {
      return input.method === "eth_chainId" ? "0x3e7" : null;
    },
  };
  await assert.rejects(
    () => ensureWalletChain(provider, elysium),
    /WALLET_CHAIN_MISMATCH/u,
  );
});

const chainId = Number(process.env.CHAIN_ID);
const rpcUrl = process.env.RPC_URL;
const wsRpcUrl = process.env.WS_RPC_URL;
const explorerUrl = process.env.BLOCK_EXPLORER_URL;

if (
  !Number.isSafeInteger(chainId) ||
  chainId <= 0 ||
  !rpcUrl ||
  !wsRpcUrl ||
  !explorerUrl
) {
  throw new Error(
    "CHAIN_ID, RPC_URL, WS_RPC_URL, and BLOCK_EXPLORER_URL are required",
  );
}

const explorer = new URL(explorerUrl);
if (explorer.protocol !== "https:") {
  throw new Error("BLOCK_EXPLORER_URL must use HTTPS");
}

const rpcResponse = await fetch(rpcUrl, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "eth_chainId",
    params: [],
  }),
  signal: AbortSignal.timeout(10_000),
});

if (!rpcResponse.ok) {
  throw new Error(`RPC health check failed with HTTP ${rpcResponse.status}`);
}

const rpcPayload = await rpcResponse.json();
if (typeof rpcPayload.result !== "string") {
  throw new Error("RPC did not return an eth_chainId result");
}

const rpcChainId = Number.parseInt(rpcPayload.result, 16);
if (rpcChainId !== chainId) {
  throw new Error(
    `RPC chain mismatch: expected ${chainId}, received ${rpcChainId}`,
  );
}

const wsUrl = new URL(wsRpcUrl);
if (wsUrl.protocol !== "wss:") {
  throw new Error("WS_RPC_URL must use WSS");
}

const wsChainId = await new Promise((resolve, reject) => {
  const socket = new WebSocket(wsRpcUrl);
  const timeout = setTimeout(() => {
    socket.close();
    reject(new Error("WebSocket RPC health check timed out"));
  }, 10_000);

  socket.addEventListener("open", () => {
    socket.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      }),
    );
  });
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(String(event.data));
    if (payload.id !== 1 || typeof payload.result !== "string") return;
    clearTimeout(timeout);
    socket.close();
    resolve(Number.parseInt(payload.result, 16));
  });
  socket.addEventListener("error", () => {
    clearTimeout(timeout);
    reject(new Error("WebSocket RPC connection failed"));
  });
});

if (wsChainId !== chainId) {
  throw new Error(
    `WebSocket RPC chain mismatch: expected ${chainId}, received ${String(wsChainId)}`,
  );
}

console.log(`Network validation passed for chain ${chainId}`);

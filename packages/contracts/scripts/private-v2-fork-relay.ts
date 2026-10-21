import { createServer } from "node:http";

const allowedMethods = new Set([
  "eth_chainId",
  "net_version",
  "web3_clientVersion",
  "eth_blockNumber",
  "eth_gasPrice",
  "eth_feeHistory",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getBalance",
  "eth_getTransactionCount",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getProof",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getLogs",
  "eth_call",
]);

/** Anvil receives only this loopback URL. The credential-bearing upstream stays in the parent. */
export async function startPrivateForkRelay(upstream: string) {
  const server = createServer(async (request, response) => {
    const send = (value: unknown) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(value));
    };
    try {
      if (request.method !== "POST") {
        response.statusCode = 405;
        response.end();
        return;
      }
      let body = "";
      for await (const chunk of request) {
        body += String(chunk);
        if (body.length > 262144) throw new Error("RPC_BODY_TOO_LARGE");
      }
      const payload: unknown = JSON.parse(body);
      const processItem = async (item: unknown) => {
        if (!item || typeof item !== "object")
          return {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32600, message: "Invalid request" },
          };
        const rpc = item as {
          method?: string;
          id?: string | number;
          params?: unknown[];
        };
        if (typeof rpc.method !== "string" || !allowedMethods.has(rpc.method))
          return {
            jsonrpc: "2.0",
            id: rpc.id ?? null,
            error: {
              code: -32601,
              message: "Read-only fork method not allowed",
            },
          };
        const result = await fetch(upstream, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: rpc.id ?? 1,
            method: rpc.method,
            params: rpc.params ?? [],
          }),
          redirect: "error",
          credentials: "omit",
          signal: AbortSignal.timeout(20_000),
        });
        if (!result.ok) throw new Error("UPSTREAM_UNAVAILABLE");
        return (await result.json()) as unknown;
      };
      if (Array.isArray(payload) && payload.length > 128)
        throw new Error("RPC_BATCH_TOO_LARGE");
      send(
        Array.isArray(payload)
          ? await Promise.all(payload.map(processItem))
          : await processItem(payload),
      );
    } catch {
      send({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32000, message: "Read-only fork source unavailable" },
      });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("LOCAL_RELAY_ADDRESS_UNAVAILABLE");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

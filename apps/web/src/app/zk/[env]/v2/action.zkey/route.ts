import type { NextRequest } from "next/server";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ env: string }> }
) {
  const { env } = await context.params;
  if (env !== "mainnet" && env !== "testnet") {
    return new Response("Not found", { status: 404 });
  }

  const origin = new URL(request.url).origin;
  const numParts = 3;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for (let i = 0; i < numParts; i++) {
          const partUrl = `${origin}/zk/${env}/v2/action.zkey.part${i}`;
          const res = await fetch(partUrl);
          if (!res.ok || !res.body) {
            controller.error(new Error(`Failed to fetch ${partUrl}: ${res.status}`));
            return;
          }
          const reader = res.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

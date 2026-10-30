import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const supportedProtocols = new Set(["http:", "https:"]);
const requestMethodsWithBody = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const strippedRequestHeaders = ["connection", "content-length", "host"];
const strippedResponseHeaders = ["connection", "content-length", "transfer-encoding"];

function upstreamBaseUrl(): URL {
  const configured = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL;
  if (!configured) throw new Error("API_PROXY_TARGET_MISSING");
  const target = new URL(configured);
  if (!supportedProtocols.has(target.protocol)) throw new Error("API_PROXY_TARGET_INVALID");
  return target;
}

async function proxy(
  request: NextRequest,
  context: Readonly<{ params: Promise<{ path: string[] }> }>,
): Promise<Response> {
  try {
    const { path } = await context.params;
    const upstream = upstreamBaseUrl();
    upstream.pathname = `${upstream.pathname.replace(/\/$/u, "")}/${path.map(encodeURIComponent).join("/")}`;
    upstream.search = request.nextUrl.search;

    const headers = new Headers(request.headers);
    strippedRequestHeaders.forEach((header) => headers.delete(header));
    headers.set("x-forwarded-host", request.nextUrl.host);
    headers.set("x-forwarded-proto", request.nextUrl.protocol.replace(":", ""));

    const response = await fetch(upstream, {
      method: request.method,
      headers,
      redirect: "manual",
      ...(requestMethodsWithBody.has(request.method)
        ? { body: await request.arrayBuffer() }
        : {}),
    });
    const responseHeaders = new Headers(response.headers);
    strippedResponseHeaders.forEach((header) => responseHeaders.delete(header));
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "API_PROXY_FAILED";
    return Response.json({ error: { code } }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;

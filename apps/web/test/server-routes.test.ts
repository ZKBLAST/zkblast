import assert from "node:assert/strict";
import test from "node:test";

import { GET as readAssetLogo } from "../src/app/asset-logo/[symbol]/route";
import { GET as readAuthSession } from "../src/app/auth-session/route";

test("asset logos stay outside the backend API rewrite and validate images", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(new Uint8Array(64), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  try {
    const response = await readAssetLogo(new Request("https://web.test"), {
      params: Promise.resolve({ symbol: "WETH" }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.match(response.headers.get("cache-control") ?? "", /max-age=86400/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("missing wallet session is a clean unauthenticated state", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiUrl = process.env.API_URL;
  process.env.API_URL = "https://api.test";
  globalThis.fetch = async () => Response.json({}, { status: 401 });
  try {
    const response = await readAuthSession(
      new Request("https://web.test/auth-session"),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { authenticated: false });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiUrl === undefined) delete process.env.API_URL;
    else process.env.API_URL = originalApiUrl;
  }
});

import type { NextConfig } from "next";

const apiProxyTarget =
  process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? null;
const widgetScriptPolicy = `script-src 'self' 'unsafe-inline'${
  process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""
}`;

function getApiProxyTarget(): string | null {
  if (!apiProxyTarget) return null;
  const target = new URL(apiProxyTarget);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("API_URL must use HTTP or HTTPS");
  }
  return target.toString().replace(/\/$/u, "");
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    ZKBLAST_CA:
      process.env.ZKBLAST_CA ?? "0x3f9ff9f1d40369f99c281375bd19d6ecbebfecd7",
  },
  transpilePackages: ["@zkblast/config", "@zkblast/sdk", "@zkblast/ui"],
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
  async rewrites() {
    const target = getApiProxyTarget();
    return target
      ? [{ source: "/api/:path*", destination: `${target}/:path*` }]
      : [];
  },
  async headers() {
    return [
      {
        source: "/launchpads/:slug/embed",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; base-uri 'none'; frame-ancestors 'self'; form-action 'none'; object-src 'none'; connect-src 'self'; img-src 'self' data:; ${widgetScriptPolicy}; style-src 'self' 'unsafe-inline'`,
          },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;

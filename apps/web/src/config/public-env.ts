// Browser requests stay on the web origin. Next.js resolves the server-only API
// target from API_URL (or the legacy NEXT_PUBLIC_API_URL) and proxies /api/*.
// No RPC, database, deployment, or backend hostname is required by client code.
export const webPublicConfig = { apiUrl: "/api" } as const;

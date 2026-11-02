import { NextResponse, type NextRequest } from "next/server";

/**
 * Widgets are intentionally same-origin only. A verified custom domain can
 * embed its own widget, while unrelated origins cannot frame ZKBLAST pages.
 */
export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    return new NextResponse("Cross-origin widget embedding is not allowed", {
      status: 403,
      headers: { "cache-control": "no-store" },
    });
  }
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  response.headers.set(
    "Content-Security-Policy",
    `default-src 'self'; base-uri 'none'; frame-ancestors 'self'; form-action 'none'; object-src 'none'; connect-src 'self'; img-src 'self' data:; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'`,
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: "/launchpads/:slug/embed",
};

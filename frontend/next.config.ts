import type { NextConfig } from "next";

/**
 * The UI is fully client-rendered (SWR against the FastAPI backend), so production ships as a
 * static export that FastAPI serves from the same origin — one Railway service, no CORS, and
 * SSE from Rafid (Phase 3) stays same-origin too. `make dev` still runs `next dev` normally.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "export",
  trailingSlash: true, // /simulation → out/simulation/index.html, which StaticFiles(html=True) serves
  images: { unoptimized: true },
};

export default nextConfig;

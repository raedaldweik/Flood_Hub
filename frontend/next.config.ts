import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The API base is read at runtime in the browser (NEXT_PUBLIC_*), nothing to proxy here.
};

export default nextConfig;

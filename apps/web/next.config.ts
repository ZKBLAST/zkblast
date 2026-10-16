import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@zkblast/config", "@zkblast/sdk", "@zkblast/ui"],
};

export default nextConfig;

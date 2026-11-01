import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@multivisons/agent",
    "@multivisons/contracts",
    "@multivisons/domain",
    "@multivisons/payments",
  ],
};

export default nextConfig;

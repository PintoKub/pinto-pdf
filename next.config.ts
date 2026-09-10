import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ponytail: pins the workspace root so a stray package-lock.json in ~/ stops
  // hijacking inference. Drop this if the app ever moves into a real monorepo.
  turbopack: { root: __dirname },
};

export default nextConfig;

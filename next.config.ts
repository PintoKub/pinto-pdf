import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ponytail: the whole app is client-side, so a static export is the whole
  // deploy. Any file server hosts it — Vercel, Cloudflare Pages, nginx, caddy.
  // Drop this the day something here actually needs a server.
  output: "export",

  // ponytail: pins the workspace root so a stray package-lock.json in ~/ stops
  // hijacking inference. Drop this if the app ever moves into a real monorepo.
  turbopack: { root: __dirname },
};

export default nextConfig;

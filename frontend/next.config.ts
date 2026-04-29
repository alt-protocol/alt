import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: '/', destination: '/discover', permanent: false },
      { source: '/dashboard', destination: '/discover', permanent: true },
    ];
  },
  experimental: {
    optimizePackageImports: [
      "recharts",
      "@tanstack/react-query",
    ],
  },
  turbopack: {
    root: __dirname,
    resolveAlias: {
      // klend-sdk imports `fs` in a server-only helper (parseKeypairFile).
      // We never call that path in the browser, so stub it out.
      fs: { browser: "./src/lib/stubs/empty.js" },
      // @drift-labs/sdk references `crypto` in digest.js (Node-only).
      // Stub it out so Turbopack doesn't try to polyfill it in the browser.
      crypto: { browser: "./src/lib/stubs/empty.js" },
    },
  },
};

export default nextConfig;

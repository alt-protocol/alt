import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: [
      "recharts",
      "@tanstack/react-query",
    ],
  },
  turbopack: {
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

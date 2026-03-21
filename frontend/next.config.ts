import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      // klend-sdk imports `fs` in a server-only helper (parseKeypairFile).
      // We never call that path in the browser, so stub it out.
      fs: { browser: "./src/lib/stubs/empty.js" },
    },
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Records the data source this build was made for; instrumentation.ts refuses
  // to start a server whose PROREZ_DATA_SOURCE differs (see
  // lib/repositories/build-data-source.ts). Only the mode name — no secrets.
  env: { PROREZ_BUILD_DATA_SOURCE: process.env.PROREZ_DATA_SOURCE?.trim() || "fixtures" },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

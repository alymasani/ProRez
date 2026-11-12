import type { NextConfig } from "next";

// Isolated build/dev folder for test servers (e.g. the render suite), so they
// can run while `npm run dev` holds .next. Only simple relative names allowed.
const distDir = process.env.PROREZ_NEXT_DIST_DIR;
if (distDir && !/^\.next-[a-z0-9-]+$/.test(distDir)) {
  throw new Error(`PROREZ_NEXT_DIST_DIR must look like ".next-render" (got "${distDir}").`);
}

const nextConfig: NextConfig = {
  // Next.js adds `<distDir>/types` paths to the tsconfig it uses; isolated
  // servers get their own (git-ignored) tsconfig so the tracked one stays clean.
  ...(distDir ? { distDir, typescript: { tsconfigPath: "tsconfig.isolated.json" } } : {}),
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

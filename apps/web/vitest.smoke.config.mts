import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/smoke/**/*.test.ts"],
    // Opt-in live check of real public boards; see tests/smoke/ats.smoke.test.ts.
  },
});

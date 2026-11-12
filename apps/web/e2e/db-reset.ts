import { execFileSync } from "node:child_process";
import path from "node:path";

const APP_ROOT = path.resolve(__dirname, "..");
const TSX = path.join(APP_ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");

/** True when running under playwright.db.config.ts. */
export const DB_MODE = process.env.E2E_DATA_SOURCE === "database";

/**
 * Resets the dedicated e2e database (never the dev database). Runs in a child
 * process so the Prisma client and seed code load under tsx.
 */
export function resetE2EDatabase({ full = false }: { full?: boolean } = {}) {
  execFileSync(TSX, ["scripts/reset-e2e-db.ts", ...(full ? [] : ["--data"])], {
    cwd: APP_ROOT,
    stdio: "inherit",
  });
}

/** Runs once when a Next.js server starts (dev or production). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkBuildDataSource } = await import("./lib/repositories/build-data-source");
  // PROREZ_BUILD_DATA_SOURCE is inlined at build time (next.config.ts `env`);
  // PROREZ_DATA_SOURCE is read from the real environment at start-up.
  const result = checkBuildDataSource(process.env.PROREZ_BUILD_DATA_SOURCE, process.env);
  if (!result.ok) {
    console.error(`\n[prorez] ${result.message}\n`);
    throw new Error(result.message);
  }
}

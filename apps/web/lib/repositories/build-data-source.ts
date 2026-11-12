import { resolveDataSource, type DataSource } from "./source";

/**
 * Production builds bake the data source in: in fixture mode every page is
 * fully static (prerendered at build time), while in database mode data is
 * read per request. Starting a fixture build with PROREZ_DATA_SOURCE=database
 * would therefore silently serve read-only demo pages. The build records its
 * mode (next.config.ts → PROREZ_BUILD_DATA_SOURCE) and the server refuses to
 * start when the runtime mode differs (instrumentation.ts).
 */
export function checkBuildDataSource(
  buildValue: string | undefined,
  runtimeEnv: Readonly<Record<string, string | undefined>>,
): { ok: true; dataSource: DataSource } | { ok: false; message: string } {
  const runtime = resolveDataSource(runtimeEnv);
  const build = resolveDataSource({ PROREZ_DATA_SOURCE: buildValue });
  if (build === runtime) return { ok: true, dataSource: runtime };
  return {
    ok: false,
    message:
      `This ProRez build was made with PROREZ_DATA_SOURCE=${build}, but the server is starting with ` +
      `PROREZ_DATA_SOURCE=${runtime}. Pages would show ${build === "fixtures" ? "read-only demo data" : "the wrong data"}. ` +
      `Rebuild with the same setting (npm run build) before running npm start.`,
  };
}

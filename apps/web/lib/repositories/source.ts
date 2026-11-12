export const DATA_SOURCES = ["fixtures", "database"] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

/**
 * Chooses where pages read data from. Defaults to fixtures so the app, unit
 * tests and e2e tests stay deterministic without a database.
 */
export function resolveDataSource(env: Readonly<Record<string, string | undefined>>): DataSource {
  const raw = env.PROREZ_DATA_SOURCE?.trim();
  if (!raw) return "fixtures";
  if ((DATA_SOURCES as readonly string[]).includes(raw)) return raw as DataSource;
  throw new Error(`Invalid PROREZ_DATA_SOURCE "${raw}". Use one of: ${DATA_SOURCES.join(", ")}.`);
}

/**
 * Common Crawl batch import (Milestone 3C).
 *
 * Common Crawl publishes a columnar URL index (Parquet, s3://commoncrawl/
 * cc-index/table/cc-main/warc/) that can be filtered for ATS hosts with any
 * Parquet engine (e.g. DuckDB or Athena) — see docs/discovery.md. Querying it
 * live needs S3/HTTP range-request infrastructure that ProRez does not run,
 * so ProRez imports the RESULT: a bounded, pre-generated file of URLs.
 *
 * Accepted formats (auto-detected per line):
 *   JSONL  {"url": "...", "timestamp": "20250915123456", "crawl": "CC-MAIN-2025-38"}
 *   CSV    url[,timestamp]  (an optional header row is skipped)
 *   text   one URL per line
 *
 * Rows are historical: every candidate is UNVERIFIED and is re-validated
 * against the live ATS by normal discovery runs. Nothing is fabricated; rows
 * that are not supported ATS URLs are counted and ignored.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import readline from "node:readline";
import type { PrismaClient } from "../generated/prisma/client";
import { prismaErrorCode } from "../mutations/result";
import { recognizeSourceUrl, recordEvidence, upsertCandidate } from "./candidates";

export const IMPORT_DEFAULT_MAX_ROWS = 50_000;
export const IMPORT_MAX_FILE_BYTES = 200 * 1024 * 1024;

export interface ImportRow {
  url: string;
  /** Crawl capture time if known (YYYYMMDDhhmmss or ISO). */
  timestamp: string | null;
  crawl: string | null;
}

/** Parses one line of JSONL, CSV or plain text; null for headers/blank/unparseable lines. */
export function parseImportLine(line: string): ImportRow | null {
  const t = line.trim();
  if (!t || t.startsWith("#")) return null;
  if (t.startsWith("{")) {
    try {
      const o = JSON.parse(t) as Record<string, unknown>;
      const url = typeof o.url === "string" ? o.url : null;
      if (!url) return null;
      return { url, timestamp: typeof o.timestamp === "string" ? o.timestamp : null, crawl: typeof o.crawl === "string" ? o.crawl : null };
    } catch {
      return null;
    }
  }
  const [first, second] = t.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  if (!first || first.toLowerCase() === "url") return null;
  return { url: first, timestamp: second || null, crawl: null };
}

export function crawlDate(timestamp: string | null): Date | null {
  if (!timestamp) return null;
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?$/.exec(timestamp);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))) : new Date(timestamp);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface ImportSummary {
  runId: string | null;
  rows: number;
  recognized: number;
  unique: number;
  newCandidates: number;
  ignored: number;
  truncated: boolean;
}

export async function importCommonCrawlFile(
  prisma: PrismaClient,
  file: string,
  options: { crawl?: string; maxRows?: number; now?: () => Date } = {},
): Promise<ImportSummary> {
  const now = options.now ?? (() => new Date());
  const maxRows = options.maxRows ?? IMPORT_DEFAULT_MAX_ROWS;
  const info = await stat(file);
  if (info.size > IMPORT_MAX_FILE_BYTES) {
    throw new Error(`The import file is ${Math.round(info.size / 1_048_576)} MB; split it into files under ${IMPORT_MAX_FILE_BYTES / 1_048_576} MB.`);
  }

  let runId: string | null = null;
  try {
    runId = (await prisma.discoveryRun.create({ data: { source: "common_crawl", trigger: "manual", startedAt: now() }, select: { id: true } })).id;
  } catch (error) {
    if (prismaErrorCode(error) === "P2002") throw new Error("Another discovery run is in progress; try the import again when it finishes.");
    throw error;
  }

  const summary: ImportSummary = { runId, rows: 0, recognized: 0, unique: 0, newCandidates: 0, ignored: 0, truncated: false };
  const seen = new Set<string>();
  const lines = readline.createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  let failure: string | null = null;
  try {
    for await (const line of lines) {
      if (line.length > 4096) {
        summary.ignored++;
        continue;
      }
      const row = parseImportLine(line);
      if (!row) continue;
      if (summary.rows >= maxRows) {
        summary.truncated = true;
        break;
      }
      summary.rows++;
      const r = recognizeSourceUrl(row.url, true);
      if (!r) {
        summary.ignored++;
        continue;
      }
      summary.recognized++;
      const key = `${r.provider}:${r.boardToken}`;
      const firstInBatch = !seen.has(key);
      seen.add(key);
      const { id, isNew } = await upsertCandidate(prisma, { recognized: r, discoveredUrl: row.url, source: "common_crawl", now: now() });
      if (isNew) summary.newCandidates++;
      if (firstInBatch) {
        summary.unique++;
        const crawl = row.crawl ?? options.crawl ?? null;
        await recordEvidence(prisma, id, {
          type: "common_crawl",
          status: "unvalidated",
          sourceUrl: row.url,
          dedupeKey: `common_crawl|${crawl ?? ""}|${key}`,
          observedAt: crawlDate(row.timestamp) ?? now(),
          metadata: { crawl, timestamp: row.timestamp, historical: true },
        });
      }
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    lines.close();
  }

  await prisma.discoveryRun.update({
    where: { id: runId },
    data: {
      status: failure ? "failed" : summary.truncated ? "partial" : "succeeded",
      finishedAt: now(),
      candidateUrls: summary.recognized,
      uniqueCandidates: summary.unique,
      newCandidates: summary.newCandidates,
      errorMessage: failure ?? (summary.truncated ? `Stopped after ${maxRows} rows (import limit).` : null),
      details: { rows: summary.rows, ignored: summary.ignored, file: file.split(/[\\/]/).pop() ?? "import" },
    },
  });
  if (failure) throw new Error(failure);
  return summary;
}

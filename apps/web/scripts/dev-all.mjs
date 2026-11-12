#!/usr/bin/env node
/**
 * Development: run the web app and the background worker together.
 *
 *   npm run dev:all
 *
 * - Two independent child processes: `next dev` and `tsx scripts/sync-worker.ts`.
 *   The worker never runs inside Next.js, so hot reload cannot start a second one.
 * - Output is prefixed [web] / [worker].
 * - Ctrl+C / SIGTERM stop both (whole process groups, so grandchildren too);
 *   if either exits, the other is stopped and this command exits with its code.
 * - `npm run dev`, `npm run worker` and `npm run worker -- --once` are unchanged.
 */
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const bin = (name) => path.join(root, "node_modules", ".bin", isWindows ? `${name}.cmd` : name);

const children = [];
let shuttingDown = false;
let exitCode = 0;

function start(label, command, args, color) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, FORCE_COLOR: process.env.FORCE_COLOR ?? "1" },
    stdio: ["ignore", "pipe", "pipe"],
    // Own process group on POSIX, so shutdown reaches every descendant.
    detached: !isWindows,
    shell: isWindows,
  });
  const prefix = `\x1b[${color}m[${label}]\x1b[0m `;
  for (const stream of [child.stdout, child.stderr]) {
    readline.createInterface({ input: stream }).on("line", (line) => process.stdout.write(`${prefix}${line}\n`));
  }
  child.on("exit", (code, signal) => {
    process.stdout.write(`${prefix}exited (${signal ?? `code ${code}`})\n`);
    child.exited = true;
    if (!shuttingDown) {
      exitCode = code ?? 1;
      shutdown(`${label} stopped`);
    } else if (children.every((c) => c.exited)) {
      process.exit(exitCode);
    }
  });
  children.push(child);
  return child;
}

function kill(child, signal) {
  if (child.exited || child.pid === undefined) return;
  try {
    if (isWindows) spawnSync("taskkill", ["/pid", String(child.pid), "/T", ...(signal === "SIGKILL" ? ["/F"] : [])], { stdio: "ignore" });
    else process.kill(-child.pid, signal);
  } catch {
    /* already gone */
  }
}

function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(`[dev:all] stopping (${reason})…\n`);
  for (const child of children) kill(child, "SIGTERM");
  // The worker waits up to 30 s for running syncs; force-stop after that.
  setTimeout(() => {
    for (const child of children) kill(child, "SIGKILL");
    process.exit(exitCode || 1);
  }, 35_000).unref();
  if (children.every((c) => c.exited)) process.exit(exitCode);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGHUP", () => shutdown("SIGHUP"));
// Last resort: never leave children behind if this process exits.
process.on("exit", () => {
  for (const child of children) kill(child, "SIGKILL");
});

start("web", bin("next"), ["dev", "-H", "127.0.0.1"], "36");
start("worker", bin("tsx"), ["scripts/sync-worker.ts"], "35");

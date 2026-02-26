import { execSync, type ExecSyncOptionsWithStringEncoding } from "node:child_process";
import type { Participant } from "./types.ts";

const execOpts: ExecSyncOptionsWithStringEncoding = {
  encoding: "utf-8",
  stdio: "pipe",
};

export function buildParticipant(p: Participant): void {
  console.log(`  Building ${p.name}...`);
  execSync(`docker compose -p rinha-${p.name} build`, {
    ...execOpts,
    cwd: p.dir,
    stdio: "inherit",
    timeout: 300_000,
  });
}

export function startParticipant(p: Participant): void {
  console.log(`  Starting ${p.name} on port ${p.port}...`);
  execSync(`APP_PORT=${p.port} docker compose -p rinha-${p.name} up -d`, {
    ...execOpts,
    cwd: p.dir,
    stdio: "inherit",
    timeout: 60_000,
  });
}

export function stopParticipant(p: Participant): void {
  console.log(`  Stopping ${p.name}...`);
  try {
    execSync(`docker compose -p rinha-${p.name} down -v --remove-orphans`, {
      ...execOpts,
      cwd: p.dir,
      stdio: "inherit",
      timeout: 60_000,
    });
  } catch {
    console.warn(`  Warning: failed to stop ${p.name}, continuing...`);
  }
}

export async function waitForHealth(
  p: Participant,
  timeoutMs = 30_000
): Promise<boolean> {
  const url = `http://localhost:${p.port}/health`;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const body = await res.json();
        if (body.status === "ok") {
          console.log(`  ${p.name} is healthy!`);
          return true;
        }
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.error(`  ${p.name} failed health check after ${timeoutMs}ms`);
  return false;
}

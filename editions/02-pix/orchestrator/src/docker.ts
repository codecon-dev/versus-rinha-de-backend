import { execSync, type ExecSyncOptionsWithStringEncoding } from "node:child_process";
import type { Participant } from "./types.ts";

// Dentro do DevContainer a app publicada no host é alcançada por
// host.docker.internal; fora dele, localhost. O devcontainer.json define APP_HOST.
const APP_HOST = process.env.APP_HOST ?? "localhost";

const execOpts: ExecSyncOptionsWithStringEncoding = {
  encoding: "utf-8",
  stdio: "pipe",
};

/** `quiet` engole a saída do docker — usado no modo apresentação. */
export function buildParticipant(p: Participant, quiet = false): void {
  if (!quiet) console.log(`  Building ${p.name}...`);
  execSync(`docker compose -p rinha-${p.name} build`, {
    ...execOpts,
    cwd: p.dir,
    stdio: quiet ? "pipe" : "inherit",
    timeout: 600_000,
  });
}

export function startParticipant(p: Participant, quiet = false): void {
  if (!quiet) console.log(`  Starting ${p.name} on port ${p.port}...`);
  execSync(`APP_PORT=${p.port} docker compose -p rinha-${p.name} up -d`, {
    ...execOpts,
    cwd: p.dir,
    stdio: quiet ? "pipe" : "inherit",
    timeout: 120_000,
  });
}

export function stopParticipant(p: Participant, quiet = false): void {
  if (!quiet) console.log(`  Stopping ${p.name}...`);
  try {
    execSync(`docker compose -p rinha-${p.name} down -v --remove-orphans`, {
      ...execOpts,
      cwd: p.dir,
      stdio: quiet ? "pipe" : "inherit",
      timeout: 120_000,
    });
  } catch {
    if (!quiet) console.warn(`  Warning: failed to stop ${p.name}, continuing...`);
  }
}

export async function waitForHealth(p: Participant, timeoutMs = 30_000, quiet = false): Promise<boolean> {
  const url = `http://${APP_HOST}:${p.port}/health`;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const body = await res.json();
        if (body.status === "ok") {
          if (!quiet) console.log(`  ${p.name} is healthy!`);
          return true;
        }
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!quiet) console.error(`  ${p.name} failed health check after ${timeoutMs}ms`);
  return false;
}

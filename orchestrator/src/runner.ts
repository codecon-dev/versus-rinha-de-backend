import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type {
  Participant,
  CorrectnessResult,
  LoadResult,
  ThroughputResult,
  LatencyResult,
} from "./types.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");

export function runCorrectnessTests(
  p: Participant
): CorrectnessResult | null {
  const testsDir = path.join(ROOT, "tests/correctness");
  const outputFile = path.join(ROOT, `results/${p.name}-correctness.json`);

  try {
    execSync(
      `npx vitest run --reporter=json --outputFile="${outputFile}"`,
      {
        cwd: testsDir,
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 120_000,
        env: {
          ...process.env,
          API_URL: `http://localhost:${p.port}`,
        },
      }
    );
  } catch {
    // vitest exits with non-zero if tests fail, that's expected
  }

  if (!existsSync(outputFile)) {
    console.error(`  No correctness results file found for ${p.name}`);
    return null;
  }

  try {
    const raw = JSON.parse(readFileSync(outputFile, "utf-8"));
    const tests = raw.testResults.flatMap((suite: any) =>
      suite.assertionResults.map((t: any) => ({
        name: t.ancestorTitles.concat(t.title).join(" > "),
        status: t.status === "passed" ? "passed" : "failed",
        duration: t.duration ?? 0,
        error: t.failureMessages?.[0],
      }))
    );

    const passed = tests.filter((t: any) => t.status === "passed").length;

    return {
      total: tests.length,
      passed,
      failed: tests.length - passed,
      tests,
    };
  } catch (e) {
    console.error(`  Failed to parse correctness results for ${p.name}:`, e);
    return null;
  }
}

export function runLoadTests(p: Participant): LoadResult | null {
  const loadDir = path.join(ROOT, "tests/load");
  const throughputOutput = path.join(
    ROOT,
    `results/${p.name}-throughput.json`
  );
  const latencyOutput = path.join(ROOT, `results/${p.name}-latency.json`);

  // Throughput test
  let throughput: ThroughputResult | null = null;
  try {
    execSync(
      `k6 run --out json=/dev/null -e BASE_URL=http://localhost:${p.port} -e OUTPUT_FILE=${throughputOutput} throughput.js`,
      {
        cwd: loadDir,
        encoding: "utf-8",
        stdio: "inherit",
        timeout: 120_000,
      }
    );
  } catch {
    // k6 exits non-zero when thresholds are crossed, that's expected
  }
  try {
    if (existsSync(throughputOutput)) {
      const raw = JSON.parse(readFileSync(throughputOutput, "utf-8"));
      throughput = {
        totalRequests: raw.metrics?.http_reqs?.values?.count ?? 0,
        rps: raw.metrics?.http_reqs?.values?.rate ?? 0,
        errorRate: raw.errorRate ?? 0,
        duration: raw.state?.testRunDurationMs ?? 0,
      };
    }
  } catch (e) {
    console.error(`  Failed to parse throughput results for ${p.name}:`, e);
  }

  // Latency test
  let latency: LatencyResult | null = null;
  try {
    execSync(
      `k6 run --out json=/dev/null -e BASE_URL=http://localhost:${p.port} -e OUTPUT_FILE=${latencyOutput} latency.js`,
      {
        cwd: loadDir,
        encoding: "utf-8",
        stdio: "inherit",
        timeout: 120_000,
      }
    );
  } catch {
    // k6 exits non-zero when thresholds are crossed, that's expected
  }
  try {
    if (existsSync(latencyOutput)) {
      const raw = JSON.parse(readFileSync(latencyOutput, "utf-8"));
      const p50 = raw.metrics?.http_req_duration?.values?.["p(50)"] ?? 0;
      const p95 = raw.metrics?.http_req_duration?.values?.["p(95)"] ?? 0;
      const p99 = raw.metrics?.http_req_duration?.values?.["p(99)"] ?? 0;
      latency = {
        p50,
        p95,
        p99,
        composite: 0.3 * p50 + 0.4 * p95 + 0.3 * p99,
      };
    }
  } catch (e) {
    console.error(`  Failed to parse latency results for ${p.name}:`, e);
  }

  if (!throughput && !latency) return null;

  return {
    throughput: throughput ?? {
      totalRequests: 0,
      rps: 0,
      errorRate: 1,
      duration: 0,
    },
    latency: latency ?? { p50: 9999, p95: 9999, p99: 9999, composite: 9999 },
  };
}

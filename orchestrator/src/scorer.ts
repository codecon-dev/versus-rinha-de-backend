import type {
  ParticipantResult,
  CorrectnessResult,
  LoadResult,
  Scores,
  FinalResults,
  RankingEntry,
} from "./types.ts";

const CRITICAL_TESTS = [
  "concurrent-clicks-100",
  "concurrent-clicks-500",
  "redirect-basic",
  "create-basic",
  "delete-existing",
];

function isCriticalTest(name: string): boolean {
  const normalized = name.toLowerCase().replace(/\s+/g, "-");
  return CRITICAL_TESTS.some((ct) => normalized.includes(ct));
}

function scoreCorrectness(result: CorrectnessResult | null): number {
  if (!result || result.total === 0) return 0;

  let score = (result.passed / result.total) * 500;

  const failedCritical = result.tests.some(
    (t) => t.status === "failed" && isCriticalTest(t.name)
  );

  if (failedCritical) {
    score = Math.max(0, score - 200);
  }

  return Math.round(score);
}

export function calculateScores(
  results: ParticipantResult[]
): ParticipantResult[] {
  // Score correctness independently
  for (const r of results) {
    r.scores.correctness = scoreCorrectness(r.correctness);
  }

  // Score throughput relatively
  const rpsList = results
    .filter((r) => r.load?.throughput)
    .map((r) => r.load!.throughput.rps);
  const bestRps = Math.max(...rpsList, 1);

  for (const r of results) {
    if (r.load?.throughput) {
      let score = (r.load.throughput.rps / bestRps) * 300;
      if (r.load.throughput.errorRate > 0.05) {
        score *= 0.5;
      }
      r.scores.throughput = Math.round(score);
    }
  }

  // Score latency relatively (inverse - lower is better)
  const composites = results
    .filter((r) => r.load?.latency)
    .map((r) => r.load!.latency.composite);
  const bestComposite = Math.min(...composites, 9999);

  for (const r of results) {
    if (r.load?.latency) {
      const score = (bestComposite / r.load.latency.composite) * 200;
      r.scores.latency = Math.round(Math.min(score, 200));
    }
  }

  // Calculate totals
  for (const r of results) {
    r.scores.total =
      r.scores.correctness + r.scores.throughput + r.scores.latency;
  }

  return results;
}

export function generateFinalResults(
  results: ParticipantResult[]
): FinalResults {
  const scored = calculateScores(results);

  const ranking: RankingEntry[] = scored
    .sort((a, b) => b.scores.total - a.scores.total)
    .map((r, i) => ({
      rank: i + 1,
      name: r.participant.name,
      total: r.scores.total,
      correctness: r.scores.correctness,
      throughput: r.scores.throughput,
      latency: r.scores.latency,
    }));

  return {
    timestamp: new Date().toISOString(),
    participants: scored,
    ranking,
  };
}

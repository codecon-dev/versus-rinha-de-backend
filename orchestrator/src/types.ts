export interface Participant {
  name: string;
  dir: string;
  port: number;
}

export interface CorrectnessResult {
  total: number;
  passed: number;
  failed: number;
  tests: TestResult[];
}

export interface TestResult {
  name: string;
  status: "passed" | "failed";
  duration: number;
  error?: string;
}

export interface LoadResult {
  throughput: ThroughputResult;
  latency: LatencyResult;
}

export interface ThroughputResult {
  totalRequests: number;
  rps: number;
  errorRate: number;
  duration: number;
}

export interface LatencyResult {
  p50: number;
  p95: number;
  p99: number;
  composite: number;
}

export interface ParticipantResult {
  participant: Participant;
  correctness: CorrectnessResult | null;
  load: LoadResult | null;
  scores: Scores;
  error?: string;
}

export interface Scores {
  correctness: number;
  throughput: number;
  latency: number;
  total: number;
}

export interface FinalResults {
  timestamp: string;
  participants: ParticipantResult[];
  ranking: RankingEntry[];
}

export interface RankingEntry {
  rank: number;
  name: string;
  total: number;
  correctness: number;
  throughput: number;
  latency: number;
}

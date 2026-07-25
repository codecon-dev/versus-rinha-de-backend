import type { FinalResults } from "./types.ts";

export function printResults(results: FinalResults): void {
  console.log("\n");
  console.log("=".repeat(80));
  console.log("  RINHA DE BACKEND - RESULTADOS");
  console.log("=".repeat(80));
  console.log("");

  // Header
  const header = [
    pad("#", 4),
    pad("Participante", 15),
    pad("Total", 8),
    pad("Corretude", 12),
    pad("Throughput", 12),
    pad("Latência", 10),
  ].join(" | ");

  console.log(header);
  console.log("-".repeat(80));

  // Rows
  for (const entry of results.ranking) {
    const row = [
      pad(String(entry.rank), 4),
      pad(entry.name, 15),
      pad(`${entry.total}/1000`, 8),
      pad(`${entry.correctness}/500`, 12),
      pad(`${entry.throughput}/300`, 12),
      pad(`${entry.latency}/200`, 10),
    ].join(" | ");
    console.log(row);
  }

  console.log("-".repeat(80));
  console.log("");

  // Detailed per-participant
  for (const p of results.participants) {
    console.log(`--- ${p.participant.name} ---`);
    if (p.error) {
      console.log(`  ERRO: ${p.error}`);
      continue;
    }
    if (p.correctness) {
      console.log(
        `  Corretude: ${p.correctness.passed}/${p.correctness.total} testes passaram`
      );
    }
    if (p.load) {
      console.log(`  Throughput: ${p.load.throughput.rps.toFixed(1)} req/s`);
      console.log(
        `  Latência: p50=${p.load.latency.p50.toFixed(1)}ms p95=${p.load.latency.p95.toFixed(1)}ms p99=${p.load.latency.p99.toFixed(1)}ms`
      );
    }
    console.log("");
  }
}

function pad(str: string, len: number): string {
  return str.padEnd(len);
}

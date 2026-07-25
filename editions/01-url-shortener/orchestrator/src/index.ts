import { readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  buildParticipant,
  startParticipant,
  stopParticipant,
  waitForHealth,
} from "./docker.ts";
import { runCorrectnessTests, runLoadTests } from "./runner.ts";
import { generateFinalResults } from "./scorer.ts";
import { printResults } from "./display.ts";
import type { Participant, ParticipantResult, Scores } from "./types.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PARTICIPANTS_DIR = path.join(ROOT, "participants");
const RESULTS_DIR = path.join(ROOT, "results");

const PORT_MAP: Record<string, number> = {
  go: 3001,
  nodejs: 3002,
  python: 3003,
  ruby: 3004,
};

function discoverParticipants(): Participant[] {
  const entries = readdirSync(PARTICIPANTS_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .filter((e) =>
      existsSync(path.join(PARTICIPANTS_DIR, e.name, "docker-compose.yml"))
    )
    .map((e) => ({
      name: e.name,
      dir: path.join(PARTICIPANTS_DIR, e.name),
      port: PORT_MAP[e.name] ?? 3000 + Object.keys(PORT_MAP).length + 1,
    }));
}

function emptyScores(): Scores {
  return { correctness: 0, throughput: 0, latency: 0, total: 0 };
}

async function runParticipant(p: Participant): Promise<ParticipantResult> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Avaliando: ${p.name.toUpperCase()}`);
  console.log(`${"=".repeat(60)}\n`);

  const result: ParticipantResult = {
    participant: p,
    correctness: null,
    load: null,
    scores: emptyScores(),
  };

  try {
    // Build
    buildParticipant(p);

    // Start
    startParticipant(p);

    // Wait for health
    const healthy = await waitForHealth(p);
    if (!healthy) {
      result.error = "Health check failed";
      return result;
    }

    // Correctness tests
    console.log(`\n  Rodando testes de corretude...`);
    result.correctness = runCorrectnessTests(p);
    if (result.correctness) {
      console.log(
        `  Resultado: ${result.correctness.passed}/${result.correctness.total} passaram`
      );
    }

    // Load tests
    console.log(`\n  Rodando testes de carga...`);
    result.load = runLoadTests(p);
  } catch (e: any) {
    result.error = e.message ?? String(e);
    console.error(`  Erro avaliando ${p.name}: ${result.error}`);
  } finally {
    stopParticipant(p);
  }

  return result;
}

async function main() {
  console.log("Rinha de Backend - Encurtador de URL\n");

  // Ensure results dir
  if (!existsSync(RESULTS_DIR)) {
    mkdirSync(RESULTS_DIR, { recursive: true });
  }

  // Discover
  const participants = discoverParticipants();
  console.log(
    `Participantes encontrados: ${participants.map((p) => p.name).join(", ")}`
  );

  if (participants.length === 0) {
    console.error("Nenhum participante encontrado!");
    process.exit(1);
  }

  // Run each sequentially
  const results: ParticipantResult[] = [];
  for (const p of participants) {
    const result = await runParticipant(p);
    results.push(result);
  }

  // Score and output
  const finalResults = generateFinalResults(results);

  // Save results
  const outputPath = path.join(RESULTS_DIR, "results.json");
  writeFileSync(outputPath, JSON.stringify(finalResults, null, 2));
  console.log(`\nResultados salvos em: ${outputPath}`);

  // Print table
  printResults(finalResults);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});

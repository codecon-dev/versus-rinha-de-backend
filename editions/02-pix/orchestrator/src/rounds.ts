// Modo apresentação: roda a mesma prova para todos os participantes, um atrás do
// outro, pausando entre as provas. O ranking só aparece no final.

import { readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import {
  buildParticipant,
  startParticipant,
  stopParticipant,
  waitForHealth,
} from "./docker.ts";
import { runRoundTests, runLoadTests } from "./runner.ts";
import { calculateScores } from "./scorer.ts";
import { discoverParticipants } from "./participants.ts";
import type {
  Participant,
  ParticipantResult,
  Scores,
  TestResult,
  FinalResults,
  RankingEntry,
} from "./types.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PARTICIPANTS_DIR = path.join(ROOT, "participants");
const RESULTS_DIR = path.join(ROOT, "results");
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

interface Round {
  title: string;
  file: string;
  pitch: string;
}

const ROUNDS: Round[] = [
  {
    title: "PROVA 1 — TRANSFERÊNCIA SIMPLES",
    file: "round1-basics.test.ts",
    pitch: "Uma conta manda pra outra, sem carga. O POST responde na hora, o worker processa, o extrato fecha.",
  },
  {
    title: "PROVA 2 — SALDO INSUFICIENTE",
    file: "round2-funds.test.ts",
    pitch: "Conta com 10 tentando mandar 50. Tem que falhar sem mover um centavo.",
  },
  {
    title: "PROVA 3 — IDEMPOTÊNCIA",
    file: "round3-idempotency.test.ts",
    pitch: "Mesma chave 50 vezes em paralelo. Um débito só.",
  },
  {
    title: "PROVA 4 — CONCORRÊNCIA",
    file: "round4-concurrency.test.ts",
    pitch: "200 transferências simultâneas numa conta que cobre 100. Tem que dar 100 concluídas, 100 falhas e saldo zero. Quem errar aqui perde 200 pontos.",
  },
];

const rl = createInterface({ input: process.stdin, output: process.stdout });

async function pause(message: string): Promise<void> {
  if (!process.stdin.isTTY) return; // em CI segue direto
  await rl.question(`\n${C.dim}${message}${C.reset}`);
}

function banner(text: string, color = C.cyan): void {
  const line = "═".repeat(64);
  console.log(`\n${color}${line}`);
  console.log(`  ${C.bold}${text}${C.reset}${color}`);
  console.log(`${line}${C.reset}\n`);
}

function emptyScores(): Scores {
  return { correctness: 0, throughput: 0, latency: 0, total: 0 };
}

/** Placar de uma prova, por participante. */
interface RoundScore {
  passed: number;
  total: number;
  failedNames: string[];
}

function printRoundBoard(
  round: Round,
  board: Map<string, RoundScore | null>,
): void {
  console.log(`\n${C.bold}  Placar da prova${C.reset}`);
  console.log(`  ${"─".repeat(48)}`);

  const entries = [...board.entries()].sort(
    (a, b) => (b[1]?.passed ?? -1) - (a[1]?.passed ?? -1)
  );

  for (const [name, score] of entries) {
    if (!score) {
      console.log(`  ${C.red}✗${C.reset} ${name.padEnd(14)} fora do ar`);
      continue;
    }
    const all = score.passed === score.total;
    const mark = all ? `${C.green}✓${C.reset}` : `${C.yellow}!${C.reset}`;
    const detail = all
      ? `${C.green}passou em tudo${C.reset}`
      : `${C.red}falhou: ${score.failedNames.slice(0, 3).join(", ")}${score.failedNames.length > 3 ? "…" : ""}${C.reset}`;
    console.log(
      `  ${mark} ${name.padEnd(14)} ${String(score.passed).padStart(2)}/${score.total}  ${detail}`
    );
  }
  console.log(`  ${"─".repeat(48)}`);
}

async function main() {
  banner("RINHA DE BACKEND — RECRIANDO O PIX", C.blue);

  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

  const participants = discoverParticipants(PARTICIPANTS_DIR);
  if (participants.length === 0) {
    console.error("Nenhum participante encontrado!");
    process.exit(1);
  }

  console.log(`  Participantes: ${participants.map((p) => p.name).join(", ")}\n`);

  // Resultado acumulado por participante
  const results = new Map<string, ParticipantResult>(
    participants.map((p) => [
      p.name,
      { participant: p, correctness: null, load: null, scores: emptyScores() },
    ])
  );
  const allTests = new Map<string, TestResult[]>(
    participants.map((p) => [p.name, []])
  );
  const alive = new Set<string>();

  // ---------------------------------------------------------------- setup ---
  await pause("Pressione ENTER para preparar os ambientes...");
  banner("PREPARANDO OS AMBIENTES", C.dim);

  for (const p of participants) {
    process.stdout.write(`  ${p.name.padEnd(14)} build... `);
    try {
      buildParticipant(p, true);
      startParticipant(p, true);
      const healthy = await waitForHealth(p, 45_000, true);
      if (healthy) {
        alive.add(p.name);
        console.log(`${C.green}no ar na porta ${p.port}${C.reset}`);
      } else {
        results.get(p.name)!.error = "Health check failed";
        console.log(`${C.red}não respondeu ao health check${C.reset}`);
      }
    } catch (e: any) {
      results.get(p.name)!.error = e.message ?? String(e);
      console.log(`${C.red}falhou no build${C.reset}`);
    }
  }

  // ------------------------------------------------------- provas 1 a 4 ---
  for (const round of ROUNDS) {
    await pause(`Pressione ENTER para começar a ${round.title.split(" — ")[0]}...`);
    banner(round.title);
    console.log(`  ${round.pitch}\n`);

    const board = new Map<string, RoundScore | null>();

    for (const p of participants) {
      if (!alive.has(p.name)) {
        board.set(p.name, null);
        continue;
      }

      process.stdout.write(
        `  ${C.bold}${p.name}${C.reset}` +
          `${" ".repeat(Math.max(1, 14 - p.name.length))}rodando... `
      );
      const result = runRoundTests(p, round.file);

      if (!result) {
        board.set(p.name, null);
        console.log(`${C.red}erro ao rodar${C.reset}`);
        continue;
      }

      allTests.get(p.name)!.push(...result.tests);
      const failedNames = result.tests
        .filter((t) => t.status === "failed")
        .map((t) => t.name.split(" > ").pop()!.split(":")[0]);

      board.set(p.name, {
        passed: result.passed,
        total: result.total,
        failedNames,
      });

      const ok = result.passed === result.total;
      console.log(
        ok
          ? `${C.green}${result.passed}/${result.total}${C.reset}`
          : `${C.yellow}${result.passed}/${result.total}${C.reset}`
      );
    }

    printRoundBoard(round, board);
  }

  // --------------------------------------------------------- prova 5: carga ---
  await pause("Pressione ENTER para começar a PROVA 5 — CARGA...");
  banner("PROVA 5 — CARGA");
  console.log(
    "  Throughput e latência. Cada um sozinho na máquina, para a medição ser justa.\n"
  );

  // Derruba todo mundo: a carga é medida com um participante por vez
  for (const p of participants) stopParticipant(p, true);

  for (const p of participants) {
    if (!alive.has(p.name)) {
      console.log(`  ${C.red}✗${C.reset} ${p.name.padEnd(14)} fora do ar`);
      continue;
    }

    console.log(`\n  ${C.bold}${p.name}${C.reset}`);
    try {
      startParticipant(p, true);
      const healthy = await waitForHealth(p, 45_000, true);
      if (!healthy) {
        console.log(`    ${C.red}não subiu${C.reset}`);
        continue;
      }

      const load = runLoadTests(p, true);
      results.get(p.name)!.load = load;

      if (load) {
        console.log(
          `    throughput: ${C.bold}${load.throughput.rps.toFixed(0)} req/s${C.reset}` +
            `   erro: ${(load.throughput.errorRate * 100).toFixed(1)}%`
        );
        console.log(
          `    latência:   p50 ${load.latency.p50.toFixed(0)}ms  ` +
            `p95 ${load.latency.p95.toFixed(0)}ms  p99 ${load.latency.p99.toFixed(0)}ms`
        );
      }
    } finally {
      stopParticipant(p, true);
    }
  }

  // ------------------------------------------------------------- resultado ---
  for (const p of participants) {
    const tests = allTests.get(p.name)!;
    if (tests.length > 0) {
      results.get(p.name)!.correctness = {
        total: tests.length,
        passed: tests.filter((t) => t.status === "passed").length,
        failed: tests.filter((t) => t.status === "failed").length,
        tests,
      };
    }
  }

  const scored = calculateScores([...results.values()]);
  const ranking: RankingEntry[] = [...scored]
    .sort((a, b) => b.scores.total - a.scores.total)
    .map((r, i) => ({
      rank: i + 1,
      name: r.participant.name,
      total: r.scores.total,
      correctness: r.scores.correctness,
      throughput: r.scores.throughput,
      latency: r.scores.latency,
    }));

  const finalResults: FinalResults = {
    timestamp: new Date().toISOString(),
    participants: scored,
    ranking,
  };
  writeFileSync(
    path.join(RESULTS_DIR, "results.json"),
    JSON.stringify(finalResults, null, 2)
  );

  await pause("Pressione ENTER para revelar o resultado final...");
  banner("RESULTADO FINAL", C.yellow);

  const medals = ["🥇", "🥈", "🥉", "  "];
  console.log(
    `  ${"".padEnd(4)}${"Participante".padEnd(16)}${"Total".padEnd(12)}${"Corretude".padEnd(12)}${"Throughput".padEnd(12)}Latência`
  );
  console.log(`  ${"─".repeat(70)}`);

  for (const entry of ranking) {
    // Sem pontuação não há medalha — quem não subiu não sobe ao pódio
    const medal = entry.total > 0 ? medals[Math.min(entry.rank - 1, 3)] : "  ";
    const line =
      `  ${medal}  ${entry.name.padEnd(15)}` +
      `${C.bold}${String(entry.total).padStart(4)}/1000${C.reset}   ` +
      `${String(entry.correctness).padStart(3)}/500     ` +
      `${String(entry.throughput).padStart(3)}/300     ` +
      `${String(entry.latency).padStart(3)}/200`;
    console.log(line);
  }
  console.log(`  ${"─".repeat(70)}`);

  const champion = ranking[0];
  if (champion && champion.total > 0) {
    console.log(
      `\n  ${C.bold}${C.yellow}Campeão: ${champion.name.toUpperCase()} — ${champion.total} pontos${C.reset}\n`
    );
  }

  // Detalhe de quem perdeu ponto crítico ou ficou pelo caminho
  for (const r of scored) {
    if (r.error) {
      console.log(`  ${C.red}${r.participant.name}: ${r.error}${C.reset}`);
    } else if (r.correctness && r.correctness.failed > 0) {
      const failed = r.correctness.tests
        .filter((t) => t.status === "failed")
        .map((t) => t.name.split(" > ").pop()!.split(":")[0]);
      console.log(
        `  ${C.dim}${r.participant.name} falhou em: ${failed.join(", ")}${C.reset}`
      );
    }
  }

  console.log(`\n  Resultados salvos em results/results.json\n`);
  rl.close();
}

main().catch((e) => {
  console.error("Fatal error:", e);
  rl.close();
  process.exit(1);
});

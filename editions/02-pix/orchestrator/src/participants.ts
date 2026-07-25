import { readdirSync, existsSync } from "node:fs";
import path from "node:path";
import type { Participant } from "./types.ts";

const FIRST_PORT = 3001;

/**
 * Um participante é qualquer pasta de `participants/` com um `docker-compose.yml`.
 * O nome da pasta é o nome que aparece no ranking, e as portas saem em ordem
 * alfabética a partir de 3001.
 */
export function discoverParticipants(participantsDir: string): Participant[] {
  return readdirSync(participantsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) =>
      existsSync(path.join(participantsDir, e.name, "docker-compose.yml"))
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e, i) => ({
      name: e.name,
      dir: path.join(participantsDir, e.name),
      port: FIRST_PORT + i,
    }));
}

# Codecon Versus — Rinha de Backend

Repositório das edições da Rinha de Backend do canal da Codecon. Em cada edição, devs de linguagens diferentes implementam **a mesma API**, sem IA, dentro do mesmo prazo. No final um orquestrador automatizado roda testes de corretude e de carga e cospe o ranking.

## Edições

| # | Tema | Linguagens | Pasta |
|---|------|-----------|-------|
| 01 | Encurtador de URL | Go, Node.js, Python, Ruby | [`editions/01-url-shortener`](editions/01-url-shortener) |
| 02 | Recriando o PIX | Crystal, C#, PHP, TypeScript (trocável) | [`editions/02-pix`](editions/02-pix) |

Cada edição é autocontida: spec (`README.md`), schema (`init.sql`), pastas dos participantes (`participants/`), testes (`tests/`), orquestrador (`orchestrator/`) e scripts (`scripts/`).

## Regras (valem para todas as edições)

- **Sem IA.** Nada de Copilot, ChatGPT ou autocomplete inteligente. Código na unha.
- Todos implementam exatamente os mesmos endpoints, contra o mesmo schema de banco.
- A aplicação roda na porta 3000 dentro do container, com os mesmos limites de CPU e memória para todo mundo.
- Tempo fixo (4 horas na edição 02).

## Scoring (1000 pontos)

| Categoria | Pontos | Método |
|-----------|--------|--------|
| Corretude | 500 | `(passed/total) * 500`, -200 se falhar teste crítico |
| Throughput | 300 | Relativo ao melhor: `(meu_rps / melhor_rps) * 300` |
| Latência | 200 | Relativo inverso: `(melhor_composite / meu_composite) * 200` |

Latência composite: `0.3 * p50 + 0.4 * p95 + 0.3 * p99`. Error rate acima de 5% no teste de throughput corta o score dessa categoria pela metade.

## Rodar uma edição

```bash
cd editions/02-pix

# Modo apresentação: prova por prova, todos lado a lado, pausando entre elas.
# O ranking só aparece no final. É o modo usado na gravação.
./scripts/rounds.sh

# Pipeline direto: um participante por vez, do início ao fim
./scripts/run.sh

# Ou testar um participante isolado
./scripts/test-local.sh php
```

Pré-requisitos: Docker, Node.js 22+ e [k6](https://k6.io) (opcional, para os testes de carga).

## Rodar com DevContainer (recomendado)

Se você usa VS Code com a extensão **Dev Containers**, dá para rodar tudo num ambiente isolado e já configurado, sem instalar Node.js nem k6 na máquina.

Pré-requisitos: [Docker](https://docs.docker.com/get-docker/) em execução e [VS Code](https://code.visualstudio.com/) com a extensão **Dev Containers** (`ms-vscode-remote.remote-containers`).

1. **Abra o projeto no DevContainer** — `Ctrl+Shift+P` → **`Dev Containers: Reopen in Container`** (ou **Rebuild containers**). O ambiente é construído a partir de `.devcontainer/devcontainer.json`, com Node, k6 e docker-outside-of-docker prontos.
2. **Rode o pipeline** da edição que quiser, no terminal do container:

```bash
cd editions/02-pix
./scripts/rounds.sh     # ou ./scripts/run.sh
```

Os scripts funcionam igual dentro e fora do DevContainer. Duas variáveis fazem essa ponte, e ambas têm default para quem roda direto no host:

| Variável | Dentro do DevContainer | Fora (default) |
|----------|------------------------|----------------|
| `APP_HOST` | `host.docker.internal` — de dentro do container, é assim que se alcança a app publicada no host | `localhost` |
| `HOST_PROJECT_PATH` | caminho do projeto **no host**, porque o bind mount do `init.sql` é resolvido pelo Docker do host, não pelo container | vazio; o compose cai no caminho relativo `../..` |

`APP_HOST` é definida pelo `devcontainer.json` e `HOST_PROJECT_PATH` também; os scripts derivam dela o caminho da edição. Se você subir um `docker compose` na mão de dentro do DevContainer, exporte `EDITION_PATH` antes:

```bash
export EDITION_PATH="$HOST_PROJECT_PATH/editions/02-pix"
```

## Começar uma edição nova

1. Copie a estrutura de uma edição existente para `editions/NN-tema/`.
2. Escreva a spec no `README.md` e o schema no `init.sql`.
3. Ajuste `orchestrator/src/scorer.ts` (`CRITICAL_TESTS`). As portas são atribuídas sozinhas, a partir de 3001, para cada pasta de `participants/` que tenha um `docker-compose.yml`.
4. Escreva os testes em `tests/correctness/` e os cenários k6 em `tests/load/`.
5. Deixe uma pasta por participante em `participants/`, com `docker-compose.yml` e `Dockerfile` prontos (app na 3000 do container + Postgres com o `init.sql`) e **sem código de aplicação** — quem quiser troca o Dockerfile pela stack que preferir.

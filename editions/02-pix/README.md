# Rinha de Backend — Recriando o PIX

Construir o fluxo de transferência do PIX: a API recebe a transferência, responde na hora e um worker liquida o dinheiro em segundo plano.

A parte difícil não é o CRUD. É o que acontece quando 200 transferências da mesma conta chegam ao mesmo tempo e só há saldo para metade delas: nenhum centavo pode ser criado, nenhum pode sumir, e nenhuma conta pode terminar no negativo.

## Como Funciona

```
                    ┌──────────────────────────────────────────────┐
  POST /transfers   │                  SUA API                     │
  ─────────────────►│               porta 3000                     │
  { payerId,        │                                              │
    payeeId,        │   valida o payload ──► grava como pending    │
    amount,         │   NÃO checa saldo            │               │
    idempotencyKey }│                              │               │
  ◄─────────────────│   responde na hora ──────────┤               │
   201 pending      │                              │               │
                    └──────────────────────────────┼───────────────┘
                                                   │
                                                   ▼
                                    ┌──────────────────────────┐
                                    │       PostgreSQL         │
                                    │   accounts  ·  transfers │
                                    └──────────────────────────┘
                                                   ▲
                                                   │  pega as pending
                    ┌──────────────────────────────┼───────────────┐
                    │                  WORKER      │               │
                    │              (segundo plano) │               │
                    │                              ▼               │
                    │              o saldo do pagador cobre?       │
                    │                ├── sim ──► debita o pagador  │
                    │                │           credita o recebedor
                    │                │           marca completed   │
                    │                └── não ──► marca failed      │
                    │                            insufficient_funds │
                    │                            sem mover dinheiro │
                    └──────────────────────────────────────────────┘

  GET /transfers/{id}              ──►  o status atual da transferência
  GET /accounts/{id}/statement     ──►  saldo + transferências completed
```

O ciclo de vida de uma transferência:

```
                    worker: saldo cobre
   pending ──────────────────────────────────► completed
      │
      │             worker: saldo não cobre
      └──────────────────────────────────────► failed
                                               failureReason: insufficient_funds
```

Uma vez `completed` ou `failed`, a transferência não muda mais de estado nunca — e não pode ser liquidada duas vezes.

## Modelo de Dados

**Todo valor monetário é inteiro, em centavos.** R$ 25,00 é `2500`. Não use float em lugar nenhum — nem no JSON, nem no banco, nem na conta que você faz no meio do caminho.

### Account

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | string | Identificador da conta, definido por quem cria |
| `balance` | int | Saldo em centavos |

### Transfer

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | string | Gerado pela API |
| `payerId` | string | Conta que paga |
| `payeeId` | string | Conta que recebe |
| `amount` | int | Valor em centavos, sempre positivo |
| `idempotencyKey` | string | Chave de deduplicação enviada pelo cliente |
| `status` | string | `pending`, `completed` ou `failed` |
| `failureReason` | string \| null | Preenchido só quando `failed` |
| `createdAt` | string | ISO 8601 em UTC |

```json
{
  "id": "9c1f8b2e-...",
  "payerId": "acc-1",
  "payeeId": "acc-2",
  "amount": 2500,
  "idempotencyKey": "abc-123",
  "status": "pending",
  "failureReason": null,
  "createdAt": "2026-07-24T12:00:00Z"
}
```

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/health` | Health check → `{ "status": "ok" }` |
| `POST` | `/accounts` | Cria conta com saldo inicial → 201 |
| `POST` | `/transfers` | Recebe a transferência e responde na hora → 201 |
| `GET` | `/transfers/{id}` | Consulta a transferência e seu status → 200 |
| `GET` | `/accounts/{id}/statement` | Extrato: saldo atual + transferências concluídas → 200 |

### `POST /accounts`

Existe para permitir a montagem dos cenários. Body:

```json
{ "id": "acc-1", "balance": 100000 }
```

Retorna `201` com a conta criada.

- `id` ausente ou vazio, `balance` ausente, negativo ou não-inteiro → `422`
- `id` já existente → `409`

### `POST /transfers`

**Recebe e responde imediatamente, sem processar.** A transferência nasce `pending` e quem move o dinheiro é o worker.

```json
{
  "payerId": "acc-1",
  "payeeId": "acc-2",
  "amount": 2500,
  "idempotencyKey": "abc-123"
}
```

Retorna `201` com o transfer em `status: "pending"`.

- Se a `idempotencyKey` já existe → `200` com o transfer original, sem criar outro e sem alterar nada nele
- Payload inválido → `422`: campo faltando, `amount` menor ou igual a zero, `amount` não-inteiro, `payerId` ou `payeeId` inexistente, `payerId` igual a `payeeId`

**Saldo não é verificado aqui.** Uma transferência de R$ 1.000,00 numa conta com R$ 10,00 recebe `201 pending` normalmente — quem reprova é o worker, na hora de liquidar.

### `GET /transfers/{id}`

Retorna `200` com o transfer e seu status atual, ou `404` se não existir.

### `GET /accounts/{id}/statement`

Retorna `200` com o saldo atual e as transferências já concluídas da conta — as que ela pagou e as que ela recebeu. Ordem: mais recente primeiro. `404` se a conta não existir.

```json
{
  "accountId": "acc-1",
  "balance": 97500,
  "transfers": [
    {
      "id": "9c1f8b2e-...",
      "payerId": "acc-1",
      "payeeId": "acc-2",
      "amount": 2500,
      "idempotencyKey": "abc-123",
      "status": "completed",
      "failureReason": null,
      "createdAt": "2026-07-24T12:00:00Z"
    }
  ]
}
```

Só entram transferências `completed`. As `pending` e as `failed` ficam de fora.

## O Worker

Roda em segundo plano consumindo as transferências `pending`, na ordem em que chegaram. Para cada uma:

- **Saldo suficiente**: debita o pagador, credita o recebedor e marca `completed`.
- **Saldo insuficiente**: marca `failed` com `failureReason: "insufficient_funds"` e **não move dinheiro nenhum**.

A checagem de saldo acontece aqui, no momento da liquidação — nunca no `POST`. Entre o recebimento e o processamento a conta pode ter sido esvaziada por outra transferência, e é exatamente aí que mora o desafio.

Onde o worker roda é escolha sua: thread no mesmo processo, container separado, várias réplicas. Só não pode liquidar a mesma transferência duas vezes.

## Invariantes

Valem em qualquer cenário, sob qualquer nível de concorrência:

1. **Conservação** — a soma dos saldos de todas as contas no final é exatamente igual à soma inicial. Nenhum centavo criado, nenhum perdido.
2. **Saldo nunca negativo** — nenhuma conta termina abaixo de zero.
3. **Idempotência** — a mesma `idempotencyKey` enviada N vezes gera exatamente um débito.
4. **Consistência do extrato** — o saldo retornado bate com o saldo inicial mais as transferências `completed` recebidas menos as pagas.
5. **Resposta não-bloqueante** — o `POST /transfers` responde sem esperar a liquidação.

## Ambiente

- A aplicação roda na **porta 3000** dentro do container
- O PostgreSQL 18 já vem com o schema criado (veja `init.sql`)
- A connection string chega na variável de ambiente `DATABASE_URL`
- Timestamps em UTC, ISO 8601
- Limites de recurso: app 1.5 CPUs / 3 GB RAM, Postgres 0.5 CPUs / 1 GB RAM

Toda transferência recebida precisa ser liquidada em segundo plano — os testes aguardam até 20 segundos por isso antes de conferir os saldos.

## Sua Stack

Nenhuma linha de aplicação vem escrita — só o Docker montado, para ninguém perder tempo brigando com build. Há uma pasta por linguagem em `participants/`:

| Pasta | Docker configurado | Ponto de entrada | Porta local |
|-------|--------------------|------------------|-------------|
| `crystal/` | Crystal, build estático em imagem alpine | `src/app.cr` | 3001 |
| `csharp/` | .NET 9, SDK no build e runtime aspnet | `Program.cs` | 3002 |
| `php/` | PHP 8.4 com FrankenPHP e Composer | `public/index.php` | 3003 |
| `typescript/` | Node 24, roda `.ts` direto | `src/server.ts` | 3004 |

Cada pasta traz `docker-compose.yml` (app na porta 3000 do container, Postgres 18 com o `init.sql` montado, `DATABASE_URL`, healthcheck e os limites de recurso) e um `Dockerfile` já validado — os quatro foram buildados e responderam `/health` antes de irem para o repo. O que falta em cada uma é o ponto de entrada da tabela acima e as dependências que você escolher.

Onde o worker roda depende da linguagem: em Crystal, C# e TypeScript ele cabe no mesmo processo da API (fiber, `BackgroundService`, loop assíncrono). No PHP não — como não há processo vivo entre requisições, o loop de liquidação pede um segundo serviço no compose. O `README.md` de cada pasta tem as instruções da sua linguagem.

**Nada disso é obrigatório.** Quer outra linguagem, outro runtime, outro framework? A pasta é sua: troque o `Dockerfile` e siga. Framework, driver de banco, ORM ou SQL na mão, pool de conexões e arquitetura são decisão sua em qualquer caso.

Se renomear a pasta (para o seu nome, por exemplo), use só letras minúsculas, números e hífen: underscore ou maiúscula quebram o `docker compose -p` do orquestrador.

Mexer no compose é permitido — trocar de imagem base, adicionar load balancer, cache ou mais réplicas da app — desde que a **soma** dos recursos continue dentro de 1.5 CPUs / 3 GB para tudo que não seja o Postgres, e que o Postgres continue sendo o banco com o mesmo `init.sql`.

## Como Você Vai Ser Avaliado

No final, um orquestrador sobe a implementação de cada um, roda a mesma bateria de testes e monta o ranking. São **1000 pontos**:

| Categoria | Pontos | Como é calculado |
|-----------|--------|------------------|
| Corretude | 500 | `(testes que passaram / total) × 500` |
| Throughput | 300 | Relativo ao melhor: `(seu rps / melhor rps) × 300` |
| Latência | 200 | Relativo ao melhor, invertido: `(melhor composite / seu composite) × 200` |

Throughput e latência são **relativos**: quem tiver o melhor número leva os 300 (ou 200) cheios, e os outros recebem proporcionalmente. Sozinho, corretude vale mais que os dois somados.

### A avaliação é feita em provas

Não é um participante de cada vez do início ao fim: é **prova por prova**, a mesma para todos, um atrás do outro. São cinco, e as quatro primeiras são exatamente os arquivos de teste que estão em `tests/correctness/` — você pode ler e rodar todos eles durante o desafio.

| Prova | Arquivo | O que cai |
|-------|---------|-----------|
| 1 — Transferência simples | `round1-basics.test.ts` | Criar conta, `POST` respondendo `pending`, worker liquidando, extrato fechando (ordem, só `completed`, 404) — 15 testes |
| 2 — Saldo insuficiente | `round2-funds.test.ts` | Conta com 10 tentando mandar 50: falha sem mover um centavo, mais os `422` de validação — 7 testes |
| 3 — Idempotência | `round3-idempotency.test.ts` | Mesma chave 50 vezes em paralelo, um débito só, e liquidação que não repete — 3 testes |
| 4 — Concorrência | `round4-concurrency.test.ts` | 200 simultâneas sobre saldo para 100, corrida por saldo exato, circulares, fan-in, conservação, saldo nunca negativo — 8 testes |
| 5 — Carga | `tests/load/` | Throughput e latência, cada um sozinho na máquina |

As quatro primeiras somam os 33 testes de corretude. **Testes críticos** — falhar em qualquer um deles custa **−200 pontos** além da nota proporcional:

`conservation-total`, `no-negative-balance`, `concurrent-overdraft-200`, `exact-balance-race`, `idempotent-transfer`, `insufficient-funds`, `non-blocking-post`, `transfer-basic`

São exatamente os que verificam que o dinheiro não é criado nem perdido. Um CRUD bonito que erra a concorrência pontua menos que uma implementação simples e correta.

### Throughput e latência (500 pontos)

Dois cenários de carga com [k6](https://k6.io), disponíveis em `tests/load/`:

- **Throughput**: rampa até 200 usuários simultâneos por 50s, com 70% de `POST /transfers` e 30% de consultas de extrato. Vale o total de requisições por segundo.
- **Latência**: 50 usuários constantes por 30s, misturando transferências, extratos e consultas. A nota usa um composite: `0.3 × p50 + 0.4 × p95 + 0.3 × p99`.

Taxa de erro acima de **5%** no teste de throughput corta o score dessa categoria pela metade — não adianta responder rápido e errado.

### Rodando a avaliação você mesmo

Os testes não são segredo: estão no repositório e você pode rodá-los durante o desafio, quantas vezes quiser.

```bash
# a sua implementação: sobe, roda os 33 testes e derruba
./scripts/test-local.sh php

# uma prova específica, com o container já no ar
cd tests/correctness
API_URL=http://localhost:3003 npx vitest run round4-concurrency.test.ts

# pipeline completo de um participante por vez, com carga e ranking
./scripts/run.sh

# modo apresentação: prova por prova, todos lado a lado (é como será na gravação)
./scripts/rounds.sh
```

## Como Desenvolver

### 1. Subir o ambiente

```bash
cd participants/php   # ou crystal, csharp, typescript
docker compose up --build
```

### 2. Testar manualmente

```bash
# Health check
curl http://localhost:3003/health

# Criar as contas
curl -X POST http://localhost:3003/accounts \
  -H "Content-Type: application/json" \
  -d '{"id": "acc-1", "balance": 100000}'

curl -X POST http://localhost:3003/accounts \
  -H "Content-Type: application/json" \
  -d '{"id": "acc-2", "balance": 0}'

# Transferir R$ 25,00
curl -X POST http://localhost:3003/transfers \
  -H "Content-Type: application/json" \
  -d '{"payerId": "acc-1", "payeeId": "acc-2", "amount": 2500, "idempotencyKey": "abc-123"}'

# Acompanhar a liquidação
curl http://localhost:3003/transfers/<id>

# Extrato
curl http://localhost:3003/accounts/acc-1/statement
```

### 3. Rodar os testes de corretude

```bash
# Roda build, sobe containers, testes, e derruba tudo
./scripts/test-local.sh php   # ou crystal, csharp, typescript
```

Ou, com o container já rodando:

```bash
cd tests/correctness
npm install  # só na primeira vez
API_URL=http://localhost:3003 npx vitest run --reporter=verbose
```

### 4. Derrubar

```bash
cd participants/php
docker compose down -v
```

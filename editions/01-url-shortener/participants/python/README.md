# Rinha de Backend - Encurtador de URL

Desafio: 4 devs (Go, Node.js, Python, Ruby) implementam a mesma API de encurtador de URL. No final, um orquestrador automatizado roda testes de corretude + carga e gera um ranking.

## O Desafio

Implementar uma API REST de encurtador de URL com os seguintes endpoints:

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/health` | Health check → `{ "status": "ok" }` |
| `POST` | `/urls` | Criar short URL → 201 (ou 200 se URL já existe) |
| `GET` | `/urls/:id` | Detalhe da URL → 200 |
| `PATCH` | `/urls/:id` | Atualizar URL/expiração → 200 |
| `DELETE` | `/urls/:id` | Deletar URL → 204 |
| `GET` | `/urls?page=1&per_page=10` | Listar URLs paginado → 200 |
| `GET` | `/:code` | Redirect → 301 + incrementa click_count |
| `GET` | `/urls/:id/stats` | Stats com clicks por dia e hora → 200 |
| `GET` | `/urls/:id/qr` | QR Code da short URL em base64 → 200 |

### Recurso URL

```json
{
  "id": "uuid-v4",
  "code": "aB3kZ7",
  "url": "https://example.com/path",
  "short_url": "http://localhost:3000/aB3kZ7",
  "expires_at": "2026-03-01T00:00:00Z",
  "created_at": "2026-02-26T12:00:00Z",
  "updated_at": "2026-02-26T12:00:00Z",
  "click_count": 0
}
```

### Listagem (`GET /urls`)

```json
{
  "data": [ ...url objects... ],
  "meta": { "page": 1, "per_page": 10, "total": 57 }
}
```

### Stats (`GET /urls/:id/stats`)

```json
{
  "id": "uuid-v4",
  "code": "aB3kZ7",
  "url": "https://example.com/path",
  "click_count": 42,
  "clicks_per_day": [
    { "date": "2026-02-26", "count": 15 },
    { "date": "2026-02-25", "count": 27 }
  ],
  "clicks_per_hour": [
    { "hour": "2026-02-26T14:00:00Z", "count": 8 },
    { "hour": "2026-02-26T13:00:00Z", "count": 7 }
  ]
}
```

### QR Code (`GET /urls/:id/qr`)

```json
{
  "qr_code": "iVBORw0KGgoAAAANSUhEUg..."
}
```

Retorna o QR Code da `short_url` codificado em base64 (imagem PNG). O conteúdo do QR Code deve ser a `short_url` completa (ex: `http://localhost:3000/aB3kZ7`).

### Criar URL (`POST /urls`)

Body:
```json
{
  "url": "https://example.com/path",
  "custom_code": "meuCode",   // opcional, max 16 chars alfanumérico
  "expires_at": "2026-03-01T00:00:00Z"  // opcional
}
```

**Idempotência**: se a `url` já foi encurtada anteriormente (e não expirou), retornar `200` com o registro existente em vez de criar um novo. Isso garante que a mesma URL sempre gera o mesmo `code`.

### Atualizar URL (`PATCH /urls/:id`)

Body (todos opcionais):
```json
{
  "url": "https://novo.example.com",
  "expires_at": "2026-04-01T00:00:00Z"
}
```

### Respostas de Erro

| Status | Quando |
|--------|--------|
| 200 | URL já existe (retorna registro existente no POST /urls) |
| 400 | URL inválida, custom_code inválido (>16 chars ou formato errado), expires_at no passado |
| 404 | Recurso não encontrado |
| 409 | custom_code já existe |
| 410 | URL expirada (no redirect) |

## Regras

- A aplicação roda na **porta 3000** dentro do container
- O banco PostgreSQL 16 já vem com o schema criado (veja `init.sql`)
- **Concorrência**: no redirect, incrementar `click_count` atomicamente (`SET click_count = click_count + 1`, NÃO read-then-write) E inserir na tabela `clicks`
- **Idempotência**: `POST /urls` com uma `url` que já foi encurtada deve retornar 200 com o registro existente (mesmo `id`, `code`, etc). O `custom_code` é ignorado nesse caso
- O `code` gerado automaticamente deve ter no mínimo 6 caracteres alfanuméricos
- Limites de recurso: app 1.5 CPUs / 3 GB RAM, Postgres 0.5 CPUs / 1 GB RAM
- Variável de ambiente `DATABASE_URL` contém a connection string do Postgres

## Stacks

| Linguagem | Framework | Server | DB Driver | QR Code |
|-----------|-----------|--------|-----------|---------|
| Go | chi v5 | stdlib net/http | pgx | go-qrcode |
| Node.js/TS | Fastify v5 | built-in | postgres (porsager) | qrcode |
| Python | FastAPI | uvicorn (4 workers) | psycopg3 | qrcode |
| Ruby | Sinatra 4 | Puma | pg + sequel | rqrcode + chunky_png |

## Como Desenvolver

Seu código fica em `participants/<sua-linguagem>/`. O template já vem com um hello world (`GET /health`) e o Docker configurado.

### 1. Subir o ambiente

```bash
cd participants/go  # ou nodejs, python, ruby
docker compose up --build
```

A app fica acessível em `http://localhost:<porta>`:
- Go: 3001
- Node.js: 3002
- Python: 3003
- Ruby: 3004

### 2. Testar manualmente

```bash
# Health check
curl http://localhost:3001/health

# Criar URL
curl -X POST http://localhost:3001/urls \
  -H "Content-Type: application/json" \
  -d '{"url": "https://google.com"}'

# Redirect
curl -v http://localhost:3001/aB3kZ7
```

### 3. Rodar os testes de corretude

```bash
# Roda build, sobe containers, testes, e derruba tudo
./scripts/test-local.sh go    # ou nodejs, python, ruby
```

Ou se já estiver com o container rodando:

```bash
cd tests/correctness
npm install  # só na primeira vez
API_URL=http://localhost:3001 npx vitest run --reporter=verbose
```

### 4. Derrubar

```bash
cd participants/go
docker compose down -v
```

## Schema do Banco

O arquivo `init.sql` na raiz é montado automaticamente no Postgres:

```sql
CREATE TABLE urls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(16) UNIQUE NOT NULL,
    url TEXT NOT NULL,
    expires_at TIMESTAMPTZ,
    click_count BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_urls_url ON urls(url);

CREATE TABLE clicks (
    id BIGSERIAL PRIMARY KEY,
    url_id UUID NOT NULL REFERENCES urls(id) ON DELETE CASCADE,
    clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## Scoring (1000 pontos)

| Categoria | Pontos | Método |
|-----------|--------|--------|
| Corretude | 500 | `(passed/total) * 500`, penalidade de -200 se falhar teste crítico |
| Throughput | 300 | Relativo ao melhor: `(meu_rps / melhor_rps) * 300` |
| Latência | 200 | Relativo inverso: `(melhor_composite / meu_composite) * 200` |

**Testes críticos** (falhar = -200 de penalidade): concurrent-clicks-100, concurrent-clicks-500, redirect-basic, create-basic, delete-existing, idempotent-create, qr-code-basic.

**Latência composite**: `0.3 * p50 + 0.4 * p95 + 0.3 * p99`

**Error rate** > 5% no throughput = 50% de penalidade no score de throughput.

## Rodar o Pipeline Completo (Orquestrador)

Pré-requisitos: Docker, Node.js 22+, k6 (opcional, para testes de carga).

```bash
./scripts/run.sh
```

Isso vai:
1. Descobrir todos os participantes em `participants/`
2. Para cada um: build → start → health check → testes de corretude → testes de carga → stop
3. Calcular scores e gerar ranking em `results/results.json`
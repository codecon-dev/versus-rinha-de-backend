# typescript

Implemente aqui a API descrita no `README.md` da edição.

Já vem pronto:

- `docker-compose.yml` — app na porta 3000 do container, Postgres 18 com o `init.sql` montado, `DATABASE_URL`, healthcheck e os limites de recurso da rinha
- `Dockerfile` — Node 24 (roda .ts direto, sem passo de build), validado subindo e respondendo `/health`

Falta você escrever:

- **src/server.ts** — o ponto de entrada que o Dockerfile espera, escutando na porta 3000
- As dependências: package.json (`npm install <pacote>`)

Não gostou da stack? A pasta é sua: troque o `Dockerfile` pela linguagem e runtime que quiser. O único contrato é responder HTTP na porta 3000 do container.

```bash
docker compose up --build
curl http://localhost:3004/health
```

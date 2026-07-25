# crystal

Implemente aqui a API descrita no `README.md` da edição.

Já vem pronto:

- `docker-compose.yml` — app na porta 3000 do container, Postgres 18 com o `init.sql` montado, `DATABASE_URL`, healthcheck e os limites de recurso da rinha
- `Dockerfile` — Crystal (build estático, imagem final alpine), validado subindo e respondendo `/health`

Falta você escrever:

- **src/app.cr** — o ponto de entrada que o Dockerfile espera, escutando na porta 3000
- As dependências: shard.yml (rode `shards install` após adicionar)

Não gostou da stack? A pasta é sua: troque o `Dockerfile` pela linguagem e runtime que quiser. O único contrato é responder HTTP na porta 3000 do container.

```bash
docker compose up --build
curl http://localhost:3001/health
```

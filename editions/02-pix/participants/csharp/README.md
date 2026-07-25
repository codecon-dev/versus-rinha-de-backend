# csharp

Implemente aqui a API descrita no `README.md` da edição.

Já vem pronto:

- `docker-compose.yml` — app na porta 3000 do container, Postgres 18 com o `init.sql` montado, `DATABASE_URL`, healthcheck e os limites de recurso da rinha
- `Dockerfile` — .NET 9 (SDK para build, runtime aspnet), validado subindo e respondendo `/health`

Falta você escrever:

- **Program.cs** — o ponto de entrada que o Dockerfile espera, escutando na porta 3000
- As dependências: app.csproj (bloco ItemGroup)

Não gostou da stack? A pasta é sua: troque o `Dockerfile` pela linguagem e runtime que quiser. O único contrato é responder HTTP na porta 3000 do container.

```bash
docker compose up --build
curl http://localhost:3002/health
```

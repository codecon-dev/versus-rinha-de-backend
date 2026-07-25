# php

Implemente aqui a API descrita no `README.md` da edição.

Já vem pronto:

- `docker-compose.yml` — app na porta 3000 do container, Postgres 18 com o `init.sql` montado, `DATABASE_URL`, healthcheck e os limites de recurso da rinha
- `Dockerfile` — PHP 8.4 com FrankenPHP, extensões `pdo_pgsql`, `opcache` e `pcntl`, Composer disponível. Se existir `composer.json`, o build roda `composer install` sozinho

Falta você escrever:

- **`public/index.php`** — o ponto de entrada que o FrankenPHP serve, ou o framework que você preferir instalar

```bash
docker compose up --build
curl http://localhost:3003/health
```

## Instalando um framework

PHP puro funciona. Se quiser Laravel, Slim ou Symfony, instale na própria pasta antes de subir — sem PHP na máquina, dá para usar a imagem do Composer:

```bash
# Laravel
docker run --rm -v "$PWD":/app -w /app composer:2 create-project laravel/laravel .

# Slim
docker run --rm -v "$PWD":/app -w /app composer:2 require slim/slim slim/psr7
```

### Se for de Laravel, dois detalhes economizam tempo

O Laravel 13 usa sessão e cache em banco por padrão, e o `init.sql` da rinha não tem essas tabelas — sem isso, todo request morre em 500. Adicione ao `environment` do serviço `api` no compose:

```yaml
      - APP_ENV=production
      - APP_DEBUG=false
      - APP_KEY=base64:COLE_AQUI   # php artisan key:generate --show
      - LOG_CHANNEL=stderr
      - SESSION_DRIVER=array
      - CACHE_STORE=array
      - QUEUE_CONNECTION=sync
      - DB_CONNECTION=pgsql
      - DB_URL=postgres://rinha:rinha@db:5432/rinha
```

E crie um `.dockerignore` com `vendor/` e `bootstrap/cache/*.php`, senão o cache de pacotes da sua máquina vaza para a imagem e quebra o build.

## O worker

O PHP não mantém processo vivo entre requisições, então o loop de liquidação não cabe dentro do serviço `api`. Suba um segundo serviço no compose apontando para o mesmo build:

```yaml
  worker:
    build: .
    command: php worker.php          # ou: php artisan pix:work
    environment:
      - DATABASE_URL=postgres://rinha:rinha@db:5432/rinha?sslmode=disable
    depends_on:
      db:
        condition: service_healthy
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: "1GB"
    networks:
      - app-network
```

Se fizer isso, baixe o limite do serviço `api` para `1.0` CPU / `2GB` — a soma dos dois precisa caber em 1.5 CPU / 3 GB. Outros caminhos valem também: Octane, `queue:work`, supervisor com várias réplicas.

Não gostou de nada disso? A pasta é sua: troque o `Dockerfile` inteiro por outra linguagem. O único contrato é responder HTTP na porta 3000 do container.

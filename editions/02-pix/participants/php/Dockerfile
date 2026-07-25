FROM dunglas/frankenphp:1-php8.4-alpine

# pdo_pgsql para o Postgres, pcntl para processos de longa duração
RUN install-php-extensions pdo_pgsql opcache pcntl
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app
COPY . .

# Instala as dependências se houver composer.json (Laravel, Slim, o que você usar)
RUN if [ -f composer.json ]; then composer install --no-dev --no-interaction --prefer-dist; fi

# FrankenPHP serve /app/public
ENV SERVER_NAME=":3000"
EXPOSE 3000

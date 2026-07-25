FROM dunglas/frankenphp:1-php8.4-alpine

# extensoes: pdo_pgsql pro Postgres, opcache pra performance, pcntl pro worker
RUN install-php-extensions pdo_pgsql opcache pcntl intl
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app

# instala deps primeiro pra cache do docker
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-interaction --prefer-dist --no-scripts --no-autoloader

COPY . .

RUN composer dump-autoload --optimize --no-dev --no-scripts \
 && mkdir -p storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs bootstrap/cache \
 && chmod -R 777 storage bootstrap/cache

ENV APP_ENV=production \
    APP_DEBUG=false \
    LOG_CHANNEL=stderr \
    SERVER_NAME=":3000"

EXPOSE 3000

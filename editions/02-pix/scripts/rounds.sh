#!/usr/bin/env bash
set -euo pipefail

# Modo apresentação: roda prova por prova, pausando entre elas.
# Uso: ./scripts/rounds.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Dentro do DevContainer os bind mounts são resolvidos pelo Docker do host, então
# o compose precisa do caminho da edição no host. Fora dele, HOST_PROJECT_PATH não
# existe e o compose cai no caminho relativo (../..).
if [ -n "${HOST_PROJECT_PATH:-}" ]; then
  export EDITION_PATH="$HOST_PROJECT_PATH/editions/$(basename "$ROOT_DIR")"
fi

for cmd in docker node npx; do
  if ! command -v "$cmd" &> /dev/null; then
    echo "ERRO: '$cmd' não encontrado. Instale antes de continuar."
    exit 1
  fi
done

if ! command -v k6 &> /dev/null; then
  echo "AVISO: 'k6' não encontrado — a prova de carga será pulada."
  echo "       Instale com: brew install k6"
  echo ""
fi

if [ ! -d "$ROOT_DIR/tests/correctness/node_modules" ]; then
  echo "Instalando dependências dos testes..."
  cd "$ROOT_DIR/tests/correctness" && npm install
fi

mkdir -p "$ROOT_DIR/results"

cd "$ROOT_DIR/orchestrator"
node --experimental-strip-types src/rounds.ts "$@"

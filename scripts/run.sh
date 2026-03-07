#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Rinha de Backend - Encurtador de URL ==="
echo ""

# Check dependencies
for cmd in docker node npx; do
  if ! command -v "$cmd" &> /dev/null; then
    echo "ERRO: '$cmd' não encontrado. Instale antes de continuar."
    exit 1
  fi
done

# Check k6 (optional - load tests will be skipped if not found)
if ! command -v k6 &> /dev/null; then
  echo "AVISO: 'k6' não encontrado. Testes de carga serão pulados."
  echo "       Instale com: brew install k6"
  echo ""
fi

# Install dependencies if needed
if [ ! -d "$ROOT_DIR/orchestrator/node_modules" ]; then
  echo "Instalando dependências do orquestrador..."
  cd "$ROOT_DIR/orchestrator" && npm install
fi

if [ ! -d "$ROOT_DIR/tests/correctness/node_modules" ]; then
  echo "Instalando dependências dos testes..."
  cd "$ROOT_DIR/tests/correctness" && npm install
fi

# Create results dir
mkdir -p "$ROOT_DIR/results"

# Run orchestrator
echo ""
echo "Iniciando orquestrador..."
echo ""
cd "$ROOT_DIR/orchestrator"
node --experimental-strip-types src/index.ts "$@"

#!/usr/bin/env bash
set -euo pipefail

# Roda testes contra uma implementação local
# Uso: ./scripts/test-local.sh <participante> [porta]
# Exemplo: ./scripts/test-local.sh go 3001

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

PARTICIPANT=${1:?Uso: $0 <go|nodejs|python|ruby> [porta]}

case "$PARTICIPANT" in
  go)      DEFAULT_PORT=3001 ;;
  nodejs)  DEFAULT_PORT=3002 ;;
  python)  DEFAULT_PORT=3003 ;;
  ruby)    DEFAULT_PORT=3004 ;;
  *)       DEFAULT_PORT=3000 ;;
esac

PORT=${2:-$DEFAULT_PORT}
PARTICIPANT_DIR="$ROOT_DIR/participants/$PARTICIPANT"

if [ ! -d "$PARTICIPANT_DIR" ]; then
  echo "ERRO: Diretório $PARTICIPANT_DIR não encontrado."
  exit 1
fi

echo "=== Testando: $PARTICIPANT na porta $PORT ==="
echo ""

# Build and start
echo "1. Construindo imagem Docker..."
cd "$PARTICIPANT_DIR"
docker compose -p "rinha-$PARTICIPANT" build

echo ""
echo "2. Subindo containers..."
APP_PORT=$PORT docker compose -p "rinha-$PARTICIPANT" up -d

# Wait for health
echo ""
echo "3. Aguardando health check..."
HEALTHY=false
for i in $(seq 1 30); do
  if curl -s "http://localhost:$PORT/health" 2>/dev/null | grep -q '"ok"'; then
    HEALTHY=true
    break
  fi
  sleep 1
done

if [ "$HEALTHY" = false ]; then
  echo "ERRO: Health check falhou após 30 segundos."
  echo "Logs do container:"
  docker compose -p "rinha-$PARTICIPANT" logs api
  docker compose -p "rinha-$PARTICIPANT" down -v
  exit 1
fi

echo "   Serviço saudável!"

# Install test deps if needed
if [ ! -d "$ROOT_DIR/tests/correctness/node_modules" ]; then
  echo ""
  echo "   Instalando dependências dos testes..."
  cd "$ROOT_DIR/tests/correctness" && npm install
fi

# Run correctness tests
echo ""
echo "4. Rodando testes de corretude..."
echo ""
cd "$ROOT_DIR/tests/correctness"
API_URL="http://localhost:$PORT" npx vitest run --reporter=verbose 2>&1 || true

# Cleanup
echo ""
echo "5. Parando containers..."
cd "$PARTICIPANT_DIR"
docker compose -p "rinha-$PARTICIPANT" down -v

echo ""
echo "=== Fim ==="

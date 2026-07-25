#!/usr/bin/env bash
set -euo pipefail

# Roda testes contra uma implementação local
# Uso: ./scripts/test-local.sh <pasta-do-participante> [porta]
# Exemplo: ./scripts/test-local.sh pantoja 3001

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Dentro do DevContainer os bind mounts são resolvidos pelo Docker do host, então
# o compose precisa do caminho da edição no host. Fora dele, HOST_PROJECT_PATH não
# existe e o compose cai no caminho relativo (../..).
if [ -n "${HOST_PROJECT_PATH:-}" ]; then
  export EDITION_PATH="$HOST_PROJECT_PATH/editions/$(basename "$ROOT_DIR")"
fi

PARTICIPANT=${1:?Uso: $0 <pasta-do-participante> [porta]}
PORT=${2:-3001}
PARTICIPANT_DIR="$ROOT_DIR/participants/$PARTICIPANT"

if [ ! -d "$PARTICIPANT_DIR" ]; then
  echo "ERRO: Diretório $PARTICIPANT_DIR não encontrado."
  echo "Participantes disponíveis:"
  ls -1 "$ROOT_DIR/participants" 2>/dev/null | grep -v '^\.gitkeep$' || echo "  (nenhum)"
  exit 1
fi

if [ ! -f "$PARTICIPANT_DIR/docker-compose.yml" ]; then
  echo "ERRO: $PARTICIPANT_DIR não tem docker-compose.yml."
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
  if curl -s "http://${APP_HOST:-localhost}:$PORT/health" 2>/dev/null | grep -q '"ok"'; then
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
API_URL="http://${APP_HOST:-localhost}:$PORT" npx vitest run --reporter=verbose 2>&1 || true

# Cleanup
echo ""
echo "5. Parando containers..."
cd "$PARTICIPANT_DIR"
docker compose -p "rinha-$PARTICIPANT" down -v

echo ""
echo "=== Fim ==="

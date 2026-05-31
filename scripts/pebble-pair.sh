#!/usr/bin/env bash
set -euo pipefail

CODE="${1:-}"
HOST="${2:-localhost:8642}"

if [ -z "$CODE" ]; then
  echo "Usage: $0 CODE [HOST:PORT]" >&2
  echo "Example: API_SERVER_KEY=xxx $0 ABCD 192.168.1.10:8642" >&2
  exit 1
fi

if [ -z "${API_SERVER_KEY:-}" ]; then
  echo "Error: set API_SERVER_KEY (from ~/.hermes/.env on the Hermes server)." >&2
  exit 1
fi

URL="http://${HOST}/pair/register"
if [[ "$HOST" == http://* ]]; then
  URL="${HOST%/}/pair/register"
fi

curl -sS -X POST "$URL" \
  -H "Authorization: Bearer ${API_SERVER_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"code\":\"${CODE}\"}"

echo

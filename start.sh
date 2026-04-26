#!/bin/bash
# Run finance-system + xterio-cfo-mcp side by side. If either dies, kill the
# other and exit non-zero so Zeabur restarts the whole container.

set -e

# finance-system reads DB_PATH (defaults to ./finance.db). xterio-cfo-mcp reads
# XTERIO_FINANCE_DB; default it to the same path so both processes see the same
# DB on the mounted volume.
export XTERIO_FINANCE_DB="${XTERIO_FINANCE_DB:-${DB_PATH:-/app/finance.db}}"

# Auth + audit DB for the MCP HTTP transport. Lives on the same volume so
# tokens survive redeploys. Override XTERIO_CFO_AUTH_DB if your volume mount
# point isn't /app/data.
export XTERIO_CFO_AUTH_DB="${XTERIO_CFO_AUTH_DB:-/app/data/auth.db}"

# MCP transport + port (separate from finance-system's PORT=8080).
export MCP_TRANSPORT=http
export PORT_MCP="${MCP_PORT:-3000}"

mkdir -p "$(dirname "$XTERIO_CFO_AUTH_DB")"

echo "[start] finance-system PORT=$PORT  DB_PATH=${DB_PATH:-finance.db}"
echo "[start] xterio-cfo-mcp PORT=$PORT_MCP  XTERIO_FINANCE_DB=$XTERIO_FINANCE_DB  XTERIO_CFO_AUTH_DB=$XTERIO_CFO_AUTH_DB"

# Start both. The MCP server gets its own PORT env var via inline override.
node /app/dist/index.js &
FIN_PID=$!

PORT="$PORT_MCP" node /app/mcp/dist/index.js &
MCP_PID=$!

shutdown() {
  echo "[start] received signal, shutting down both processes"
  kill -TERM "$FIN_PID" "$MCP_PID" 2>/dev/null || true
  wait "$FIN_PID" "$MCP_PID" 2>/dev/null || true
  exit 0
}
trap shutdown INT TERM

# Exit (non-zero) if either child dies — Zeabur will restart the container.
wait -n "$FIN_PID" "$MCP_PID"
EXIT_CODE=$?
echo "[start] one process exited (code $EXIT_CODE), tearing down the other"
kill -TERM "$FIN_PID" "$MCP_PID" 2>/dev/null || true
wait "$FIN_PID" "$MCP_PID" 2>/dev/null || true
exit "$EXIT_CODE"

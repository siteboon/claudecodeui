#!/usr/bin/env bash
# BnM Claude CLI — Stack Startup Script (Linux/Mac)
# Starts all 4 services: 9Router, CrewAI Bridge, CloudCLI UI
# Usage: ./start-stack.sh

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
ROUTER_DIR="${ROUTER_DIR:-$HOME/Dev/tools/9router}"
CREWAI_DIR="${CREWAI_DIR:-$HOME/Dev/tools/CrewAI-Studio}"
CLOUDCLI_DIR="$ROOT"

wait_for_health() {
  local url="$1" name="$2" timeout="${3:-30}"
  local deadline=$((SECONDS + timeout))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if curl -sf --max-time 2 "$url" > /dev/null 2>&1; then
      echo "  [OK] $name is healthy"
      return 0
    fi
    sleep 2
  done
  echo "  [FAIL] $name did not respond within ${timeout}s"
  return 1
}

echo ""
echo "=== BnM Claude CLI Stack ==="
echo ""

# 1. Start 9Router
if [ -f "$ROUTER_DIR/package.json" ]; then
  echo "[1/3] Starting 9Router (:20128)..."
  (cd "$ROUTER_DIR" && npm run dev &) > /dev/null 2>&1
  wait_for_health "http://localhost:20128" "9Router" || true
else
  echo "[1/3] 9Router directory not found at $ROUTER_DIR — skipping"
fi

# 2. Start CrewAI FastAPI Bridge
if [ -f "$CREWAI_DIR/bridge/api.py" ]; then
  echo "[2/3] Starting CrewAI Bridge (:8000)..."
  if [ -f "$CREWAI_DIR/venv/bin/python" ]; then
    (cd "$CREWAI_DIR" && venv/bin/python bridge/api.py &) > /dev/null 2>&1
  else
    (cd "$CREWAI_DIR" && python bridge/api.py &) > /dev/null 2>&1
  fi
  wait_for_health "http://localhost:8000/health" "CrewAI Bridge" || true
else
  echo "[2/3] CrewAI bridge not found at $CREWAI_DIR/bridge/api.py — skipping"
fi

# 3. Start CloudCLI UI
echo "[3/3] Starting CloudCLI UI (:3001)..."
(cd "$CLOUDCLI_DIR" && npm run dev &) > /dev/null 2>&1
wait_for_health "http://localhost:3001/api/health" "CloudCLI UI" || true

echo ""
echo "=== Stack Ready ==="
echo "  CloudCLI UI:   http://localhost:3001"
echo "  9Router:       http://localhost:20128"
echo "  CrewAI Bridge: http://localhost:8000"
echo ""

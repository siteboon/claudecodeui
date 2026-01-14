#!/bin/bash
# Claude Code UI + Cloudflare Tunnel 起動スクリプト
# 使用方法: ./scripts/start-with-tunnel.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# 色付き出力
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}Claude Code UI + Tunnel を起動します${NC}"
echo -e "${BLUE}========================================${NC}"

# npm run dev:tunnel を実行
npm run dev:tunnel

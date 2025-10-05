#!/bin/bash

# Stop script for Claude Code UI
# This cleanly stops the server

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Default port
PORT="${PORT:-3001}"

echo -e "${YELLOW}Stopping Claude Code UI...${NC}"

# Check if server is running on the port
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo -e "${YELLOW}Found process on port $PORT. Stopping...${NC}"

    # Kill process on the port
    lsof -ti:$PORT | xargs kill -9 2>/dev/null || true

    # Wait a moment
    sleep 1

    # Verify it's stopped
    if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1 ; then
        echo -e "${RED}Failed to stop server on port $PORT${NC}"
        exit 1
    else
        echo -e "${GREEN}Server stopped successfully.${NC}"
    fi
else
    echo -e "${YELLOW}No server running on port $PORT.${NC}"
fi

# Also kill any node processes running server/index.js
if pgrep -f "node server/index.js" >/dev/null 2>&1 ; then
    echo -e "${YELLOW}Stopping additional server processes...${NC}"
    pkill -f "node server/index.js" || true
    sleep 1
    echo -e "${GREEN}All server processes stopped.${NC}"
fi

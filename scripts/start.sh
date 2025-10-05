#!/bin/bash

# Start script for Claude Code UI
# This ensures clean startup of the server

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Default port
PORT="${PORT:-3001}"

echo -e "${YELLOW}Starting Claude Code UI...${NC}"

# Change to project directory
cd "$PROJECT_DIR"

# Check for processes using the port and stop them
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo -e "${YELLOW}Port $PORT is already in use.${NC}"

    # Get process info
    PROC_INFO=$(lsof -i:$PORT | grep LISTEN)
    echo -e "${YELLOW}Process details:${NC}"
    echo "$PROC_INFO"

    # Stop any Claude Code UI servers (local or global npm package)
    if pgrep -f "claude-code-ui" >/dev/null 2>&1 ; then
        echo -e "${YELLOW}Stopping existing Claude Code UI server...${NC}"
        pkill -9 -f "claude-code-ui" || true
        sleep 1
    fi

    if pgrep -f "node server/index.js" >/dev/null 2>&1 ; then
        echo -e "${YELLOW}Stopping local server process...${NC}"
        pkill -9 -f "node server/index.js" || true
        sleep 1
    fi

    # Force kill whatever is on the port
    if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1 ; then
        echo -e "${YELLOW}Force stopping process on port $PORT...${NC}"
        lsof -ti:$PORT | xargs kill -9 2>/dev/null || true
        sleep 2
    fi

    # Verify port is free
    if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1 ; then
        echo -e "${RED}Failed to free port $PORT.${NC}"
        echo -e "${RED}The port may be in use by Tailscale serve. Run:${NC}"
        echo -e "${YELLOW}  /Applications/Tailscale.app/Contents/MacOS/Tailscale serve reset${NC}"
        exit 1
    fi

    echo -e "${GREEN}Port $PORT is now available.${NC}"
fi

# Check if dist folder exists
if [ ! -d "dist" ]; then
    echo -e "${YELLOW}No dist folder found. Running build...${NC}"
    npm run build
fi

# Start the server
echo -e "${GREEN}Starting server on port $PORT...${NC}"
NODE_ENV=production node server/index.js

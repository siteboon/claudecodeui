#!/bin/bash

# Claude Code UI Control Script
# Usage: ccui.sh [start|stop]

PROJECT_DIR="/Users/alexsuprun/Documents/my-code/claudecodeui"
SERVER_PORT=3001
CLIENT_PORT=5173
LOG_FILE="$PROJECT_DIR/ccui.log"
PID_FILE="$PROJECT_DIR/ccui.pid"

start() {
    echo "🚀 Starting Claude Code UI..."

    # Check if already running
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            echo "⚠️  Claude Code UI is already running (PID: $PID)"
            echo "💡 Use 'ccui stop' to stop it first"
            return 1
        else
            # PID file exists but process is dead, clean it up
            rm "$PID_FILE"
        fi
    fi

    # Check and kill processes on both ports
    for PORT in $SERVER_PORT $CLIENT_PORT; do
        PORT_PIDS=$(lsof -ti:$PORT 2>/dev/null)
        if [ ! -z "$PORT_PIDS" ]; then
            echo "⚠️  Port $PORT is in use by processes: $PORT_PIDS"
            echo "🔧 Killing processes on port $PORT..."
            kill -9 $PORT_PIDS 2>/dev/null
            sleep 1
        fi
    done

    # Ensure .env exists
    if [ ! -f "$PROJECT_DIR/.env" ]; then
        echo "📝 Creating .env from .env.example..."
        cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
    fi

    # Start the dev server (both backend and frontend) in background
    cd "$PROJECT_DIR"
    echo "📦 Starting development servers (backend + frontend)..."
    nohup npm run dev > "$LOG_FILE" 2>&1 &

    # Save PID
    echo $! > "$PID_FILE"

    echo ""
    echo "⏳ Waiting for servers to start..."

    # Wait for both server and client to be ready
    MAX_WAIT=30
    WAIT_COUNT=0
    SERVER_READY=false
    CLIENT_READY=false

    while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
        # Check server port
        if ! $SERVER_READY && lsof -ti:$SERVER_PORT > /dev/null 2>&1; then
            echo "✅ Backend server ready on port $SERVER_PORT"
            SERVER_READY=true
        fi

        # Check client port
        if ! $CLIENT_READY && lsof -ti:$CLIENT_PORT > /dev/null 2>&1; then
            echo "✅ Frontend client ready on port $CLIENT_PORT"
            CLIENT_READY=true
        fi

        # Break if both are ready
        if $SERVER_READY && $CLIENT_READY; then
            break
        fi

        sleep 1
        WAIT_COUNT=$((WAIT_COUNT + 1))
    done

    echo ""
    if $SERVER_READY && $CLIENT_READY; then
        echo "✅ Claude Code UI started successfully!"
        echo "🌐 Server: http://localhost:$SERVER_PORT"
        echo "🎨 Client: http://localhost:$CLIENT_PORT"
        echo "📝 Logs: $LOG_FILE"
        echo "💡 Use 'ccui stop' to stop all servers"
        echo ""

        # Open browser
        echo "🌐 Opening browser..."
        if command -v open > /dev/null 2>&1; then
            open "http://localhost:$CLIENT_PORT"
        elif command -v xdg-open > /dev/null 2>&1; then
            xdg-open "http://localhost:$CLIENT_PORT"
        else
            echo "⚠️  Could not auto-open browser. Please open http://localhost:$CLIENT_PORT manually"
        fi

        echo ""
        echo "📊 Recent logs:"
        tail -n 10 "$LOG_FILE"
    else
        echo "⚠️  Servers may not have started properly within $MAX_WAIT seconds"
        echo "📝 Check logs for details: $LOG_FILE"
        echo "💡 Or run: ccui logs"
    fi
}

stop() {
    echo "🛑 Stopping Claude Code UI..."

    if [ ! -f "$PID_FILE" ]; then
        echo "⚠️  No PID file found"

        # Try to kill by ports
        for PORT in $SERVER_PORT $CLIENT_PORT; do
            PORT_PIDS=$(lsof -ti:$PORT 2>/dev/null)
            if [ ! -z "$PORT_PIDS" ]; then
                echo "🔧 Found processes on port $PORT: $PORT_PIDS"
                kill -9 $PORT_PIDS 2>/dev/null
                echo "✅ Killed processes on port $PORT"
            fi
        done
        return 0
    fi

    PID=$(cat "$PID_FILE")

    # Kill the main process and its children
    if ps -p "$PID" > /dev/null 2>&1; then
        echo "🔧 Killing process tree for PID $PID..."

        # Kill child processes first
        pkill -P "$PID" 2>/dev/null

        # Kill main process
        kill "$PID" 2>/dev/null
        sleep 1

        # Force kill if still running
        if ps -p "$PID" > /dev/null 2>&1; then
            echo "⚡ Force killing process $PID..."
            kill -9 "$PID" 2>/dev/null
        fi

        echo "✅ Process stopped"
    else
        echo "ℹ️  Process $PID is not running"
    fi

    # Clean up any remaining processes on both ports
    for PORT in $SERVER_PORT $CLIENT_PORT; do
        PORT_PIDS=$(lsof -ti:$PORT 2>/dev/null)
        if [ ! -z "$PORT_PIDS" ]; then
            echo "🔧 Cleaning up remaining processes on port $PORT..."
            kill -9 $PORT_PIDS 2>/dev/null
        fi
    done

    # Remove PID file
    rm -f "$PID_FILE"
    echo "🧹 Cleaned up PID file"
}

status() {
    echo "📊 Claude Code UI Status"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            echo "✅ Running (PID: $PID)"
            echo "🌐 Server: http://localhost:$SERVER_PORT"
            echo "🎨 Client: http://localhost:$CLIENT_PORT"
            echo "📝 Logs: $LOG_FILE"
        else
            echo "❌ Not running (stale PID file)"
        fi
    else
        echo "❌ Not running"
    fi

    echo ""
    echo "Port Status:"

    # Check server port
    SERVER_PIDS=$(lsof -ti:$SERVER_PORT 2>/dev/null)
    if [ ! -z "$SERVER_PIDS" ]; then
        echo "🔌 Server port $SERVER_PORT in use by: $SERVER_PIDS"
    else
        echo "🔌 Server port $SERVER_PORT is free"
    fi

    # Check client port
    CLIENT_PIDS=$(lsof -ti:$CLIENT_PORT 2>/dev/null)
    if [ ! -z "$CLIENT_PIDS" ]; then
        echo "🔌 Client port $CLIENT_PORT in use by: $CLIENT_PIDS"
    else
        echo "🔌 Client port $CLIENT_PORT is free"
    fi
}

# Main command handler
COMMAND=${1:-start}

case "$COMMAND" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        stop
        sleep 2
        start
        ;;
    status)
        status
        ;;
    logs)
        if [ -f "$LOG_FILE" ]; then
            tail -f "$LOG_FILE"
        else
            echo "❌ No log file found at $LOG_FILE"
        fi
        ;;
    *)
        echo "Usage: ccui.sh [start|stop|restart|status|logs]"
        echo ""
        echo "Commands:"
        echo "  start    - Start the server (default)"
        echo "  stop     - Stop the server"
        echo "  restart  - Restart the server"
        echo "  status   - Check server status"
        echo "  logs     - Follow server logs"
        exit 1
        ;;
esac
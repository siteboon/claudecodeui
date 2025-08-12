#!/bin/bash
set -e

echo "🐳 Starting Claude Code UI Container..."

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to wait for a service to be available
wait_for_service() {
    local host="$1"
    local port="$2"
    local service_name="$3"
    local max_attempts=30
    local attempt=1

    echo "⏳ Waiting for $service_name to be available..."
    
    while ! nc -z "$host" "$port" 2>/dev/null; do
        if [ $attempt -eq $max_attempts ]; then
            echo "❌ Failed to connect to $service_name after $max_attempts attempts"
            exit 1
        fi
        echo "   Attempt $attempt/$max_attempts: $service_name not ready yet..."
        sleep 2
        attempt=$((attempt + 1))
    done
    
    echo "✅ $service_name is ready!"
}

# Initialize Claude configuration if needed
if [ ! -f /home/nodejs/.claude/config.json ] && [ -n "$CLAUDE_API_KEY" ]; then
    echo "🔧 Initializing Claude CLI configuration..."
    mkdir -p /home/nodejs/.claude
    echo '{"api_key": "'$CLAUDE_API_KEY'"}' > /home/nodejs/.claude/config.json
    echo "✅ Claude CLI configured with provided API key"
fi

# Verify Claude CLI installation
if command_exists claude; then
    echo "✅ Claude CLI is available"
    claude --version || echo "⚠️ Claude CLI version check failed (might need API key)"
else
    echo "⚠️ Claude CLI not found in PATH"
fi

# Verify Python and uv installation
if command_exists python3; then
    echo "✅ Python3 is available: $(python3 --version)"
else
    echo "❌ Python3 not found"
fi

if command_exists uv; then
    echo "✅ uv is available: $(uv --version)"
else
    echo "❌ uv not found"
fi

# Verify Node.js and npm
if command_exists node; then
    echo "✅ Node.js is available: $(node --version)"
else
    echo "❌ Node.js not found"
fi

if command_exists npm; then
    echo "✅ npm is available: $(npm --version)"
else
    echo "❌ npm not found"
fi

# Create necessary directories
mkdir -p /app/uploads /app/data /home/nodejs/.claude/projects

# Set proper permissions
chmod 755 /app/uploads /app/data

# Check if we're in development mode
if [ "$NODE_ENV" = "development" ]; then
    echo "🔨 Starting in development mode..."
else
    echo "🚀 Starting in production mode..."
fi

# Start the application
echo "🎯 Starting Claude Code UI server..."
exec node server/index.js
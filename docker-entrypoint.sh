#!/bin/sh
set -e

# Create symlinks for host user's home directory if mounted
if [ -n "$CLAUDE_HOME" ] && [ -d "$CLAUDE_HOME" ] && [ "$CLAUDE_HOME" != "/root" ]; then
    echo "Setting up symlinks for host directories..."
    
    # Create symlink for easier access to host home
    if [ ! -e "/host-home" ]; then
        ln -s "$CLAUDE_HOME" /host-home
        echo "Created symlink: /host-home -> $CLAUDE_HOME"
    fi
fi

# Ensure Claude directories exist with proper permissions
mkdir -p /root/.claude/projects /root/.claude/logs /root/.config/claude
chmod -R 755 /root/.claude /root/.config

# Check if Claude CLI is accessible
if command -v claude >/dev/null 2>&1; then
    echo "Claude CLI is available at: $(which claude)"
    claude --version || echo "Claude CLI found but version check failed"
else
    echo "Warning: Claude CLI not found in PATH"
fi

# Check Claude configuration
if [ -f "/root/.claude/auth.json" ]; then
    echo "Claude authentication found"
else
    echo "Warning: Claude authentication not found at /root/.claude/auth.json"
    echo "You may need to authenticate Claude CLI on the host machine first"
fi

# Log mount points for debugging
echo "Current mount points:"
mount | grep -E "(claude|home)" || true

echo "Starting Claude Code UI server..."
exec "$@"
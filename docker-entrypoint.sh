#!/bin/bash
set -e

echo "🚀 Claude Code UI - Container Initialization"
echo "==========================================="

# Run initialization scripts if they exist
if [ -d "/init-scripts" ] && [ "$(ls -A /init-scripts/*.sh 2>/dev/null)" ]; then
    echo ""
    echo "📝 Running initialization scripts..."
    echo ""

    # Sort and execute all .sh files in /init-scripts
    for script in /init-scripts/*.sh; do
        if [ -f "$script" ] && [ -x "$script" ]; then
            echo "▶️  Executing: $(basename "$script")"
            if bash "$script"; then
                echo "   ✅ Success: $(basename "$script")"
            else
                echo "   ⚠️  Warning: $(basename "$script") failed with exit code $?"
                echo "   Continuing anyway..."
            fi
            echo ""
        elif [ -f "$script" ]; then
            echo "⚠️  Skipping non-executable script: $(basename "$script")"
            echo "   Run: chmod +x $(basename "$script") to enable"
            echo ""
        fi
    done

    echo "✅ Initialization scripts completed"
    echo ""
else
    echo "ℹ️  No initialization scripts found in /init-scripts"
    echo "   Create .sh files in /init-scripts to customize your environment"
    echo ""
fi

echo "==========================================="
echo "🎯 Starting Claude Code UI Server..."
echo ""

# Start the Node.js server
exec node server/index.js

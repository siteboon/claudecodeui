#!/bin/bash
# Example: Install additional tools and packages
# This script demonstrates how to install extra tools on container startup

echo "🔧 Installing additional tools..."

# NOTE: Most installations require root privileges
# This example shows what's possible if the container is run with appropriate permissions
# For npm packages, you can install globally without root if npm is configured properly

# Example: Install additional npm packages globally
# Uncomment and modify as needed

# echo "📦 Installing npm packages..."
# npm install -g \
#     typescript \
#     prettier \
#     eslint \
#     nodemon
#
# echo "✅ npm packages installed"

# Example: Create useful shell aliases
# Uncomment and modify as needed

# if [ ! -f "/home/node/.bash_aliases" ]; then
#     cat > /home/node/.bash_aliases <<EOF
# # Custom aliases
# alias ll='ls -lah'
# alias gs='git status'
# alias gp='git pull'
# alias gc='git commit'
# alias ..='cd ..'
# alias ...='cd ../..'
# EOF
#     echo "✅ Shell aliases created"
# fi

echo "ℹ️  Example script - edit to enable tool installation"

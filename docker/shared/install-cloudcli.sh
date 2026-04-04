#!/bin/bash
set -e

# Install Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -

# Install Node.js + build tools needed for native modules (node-pty, better-sqlite3, bcrypt)
# Node.js + build tools for native modules + common dev tools
apt-get install -y --no-install-recommends \
  nodejs build-essential python3 python3-setuptools \
  jq ripgrep sqlite3 zip unzip tree vim-tiny

# Clean up apt cache to reduce image size
rm -rf /var/lib/apt/lists/*

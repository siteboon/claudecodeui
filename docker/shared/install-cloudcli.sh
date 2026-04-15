#!/bin/bash
set -e

# Install build tools needed for native modules (node-pty, better-sqlite3, bcrypt)
# Node.js is already provided by the sandbox base image
apt-get update && apt-get install -y --no-install-recommends \
  build-essential python3 python3-setuptools \
  jq ripgrep sqlite3 zip unzip tree vim-tiny

# Clean up apt cache to reduce image size
rm -rf /var/lib/apt/lists/*

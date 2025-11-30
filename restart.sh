#!/bin/bash

MODE="${1:-dev}"

echo "🔄 Restarting services in $MODE mode..."

echo "🛑 Stopping existing processes..."

if lsof -ti:3002 > /dev/null 2>&1; then
  echo "  ⏹️  Killing backend on port 3002..."
  lsof -ti:3002 | xargs kill -15 2>/dev/null || true
  sleep 1
  if lsof -ti:3002 > /dev/null 2>&1; then
    echo "  ⚠️  Force killing backend..."
    lsof -ti:3002 | xargs kill -9 2>/dev/null || true
  fi
else
  echo "  ✓ No backend process on port 3002"
fi

if lsof -ti:5173 > /dev/null 2>&1; then
  echo "  ⏹️  Killing frontend on port 5173..."
  lsof -ti:5173 | xargs kill -15 2>/dev/null || true
  sleep 1
  if lsof -ti:5173 > /dev/null 2>&1; then
    echo "  ⚠️  Force killing frontend..."
    lsof -ti:5173 | xargs kill -9 2>/dev/null || true
  fi
else
  echo "  ✓ No frontend process on port 5173"
fi

echo "⏳ Waiting for ports to be freed..."
sleep 2

echo "🚀 Starting services..."

if [ "$MODE" = "prod" ]; then
  echo "  Starting in production mode (npm start)..."
  npm start
else
  echo "  Starting in development mode (npm run dev)..."
  npm run dev
fi

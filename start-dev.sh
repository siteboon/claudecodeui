#!/bin/bash
# 開發環境啟動腳本

echo "🚀 啟動 Claude Code UI 開發環境..."

# 啟動後端伺服器
echo "📡 啟動後端伺服器 (port 3002)..."
node server/index.js &
SERVER_PID=$!

# 等待後端啟動
sleep 2

# 啟動前端開發伺服器
echo "🎨 啟動前端開發伺服器 (port 3001)..."
npx vite --host --port 3001 &
CLIENT_PID=$!

echo "✅ 開發環境已啟動！"
echo "   前端: http://localhost:3001"
echo "   後端: http://localhost:3002"
echo ""
echo "按 Ctrl+C 停止所有服務..."

# 捕獲中斷信號
trap "echo '🛑 停止所有服務...'; kill $SERVER_PID $CLIENT_PID 2>/dev/null; exit" INT

# 等待直到收到中斷信號
wait
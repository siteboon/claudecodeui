#!/bin/bash
# macOSアプリ(.app)を作成するスクリプト
# 使用方法: ./scripts/create-macos-app.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
APP_NAME="Claude Code UI"
APP_DIR="$HOME/Desktop/${APP_NAME}.app"

echo "Creating macOS app: $APP_DIR"

# .app構造を作成
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

# Info.plist を作成
cat > "$APP_DIR/Contents/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>launcher</string>
    <key>CFBundleIdentifier</key>
    <string>com.siteboon.claude-code-ui</string>
    <key>CFBundleName</key>
    <string>Claude Code UI</string>
    <key>CFBundleDisplayName</key>
    <string>Claude Code UI</string>
    <key>CFBundleVersion</key>
    <string>1.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.15</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
EOF

# ランチャースクリプトを作成
cat > "$APP_DIR/Contents/MacOS/launcher" << EOF
#!/bin/bash
# Claude Code UI + Cloudflare Tunnel ランチャー

PROJECT_DIR="$PROJECT_DIR"
LOG_FILE="/tmp/claude-code-ui.log"

# Terminal.appで実行
osascript -e "
tell application \"Terminal\"
    activate
    do script \"cd '\$PROJECT_DIR' && npm run dev:tunnel 2>&1 | tee '\$LOG_FILE'\"
end tell
"
EOF

chmod +x "$APP_DIR/Contents/MacOS/launcher"

# アイコンをコピー（存在する場合）
if [ -f "$PROJECT_DIR/public/logo.svg" ]; then
    # SVGからICNSを作成（sipiが必要）
    # 簡易的にPNGをコピー
    cp "$PROJECT_DIR/public/logo.svg" "$APP_DIR/Contents/Resources/AppIcon.svg" 2>/dev/null || true
fi

# PNG アイコンがあればコピー
if [ -f "$PROJECT_DIR/public/icons/icon-512x512.png" ]; then
    cp "$PROJECT_DIR/public/icons/icon-512x512.png" "$APP_DIR/Contents/Resources/AppIcon.png" 2>/dev/null || true
fi

echo ""
echo "✅ アプリを作成しました: $APP_DIR"
echo ""
echo "使い方:"
echo "  1. デスクトップの '${APP_NAME}' アイコンをダブルクリック"
echo "  2. Terminalが開き、Claude Code UI + Tunnelが起動します"
echo ""
echo "オプション:"
echo "  - Dockに追加: アプリをDockにドラッグ"
echo "  - ログイン時に自動起動: システム設定 > ログイン項目 に追加"

#!/bin/bash
# macOSメニューバーアプリを作成するスクリプト
# サーバーの起動/停止をメニューバーから制御
# 使用方法: ./scripts/create-menubar-app.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
APP_NAME="Claude Code UI Menu"
APP_DIR="$HOME/Applications/${APP_NAME}.app"

echo "Creating macOS menubar app: $APP_DIR"

# 古いアプリを削除
rm -rf "$APP_DIR"

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
    <string>menubar</string>
    <key>CFBundleIdentifier</key>
    <string>com.siteboon.claude-code-ui-menu</string>
    <key>CFBundleName</key>
    <string>Claude Code UI Menu</string>
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
    <key>LSUIElement</key>
    <true/>
</dict>
</plist>
EOF

# メニューバーアプリのメインスクリプト
cat > "$APP_DIR/Contents/MacOS/menubar" << 'MAINSCRIPT'
#!/bin/bash

# 設定
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RESOURCES_DIR="$SCRIPT_DIR/../Resources"
PID_FILE="/tmp/claude-code-ui.pid"
LOG_FILE="/tmp/claude-code-ui.log"

# プロジェクトディレクトリをResourcesから読み込む
PROJECT_DIR="$(cat "$RESOURCES_DIR/project_dir.txt" 2>/dev/null)"
if [ -z "$PROJECT_DIR" ] || [ ! -d "$PROJECT_DIR" ]; then
    osascript -e 'display dialog "Claude Code UIのプロジェクトディレクトリが見つかりません。" buttons {"OK"} default button "OK" with icon stop'
    exit 1
fi

# サーバーが実行中かチェック
is_running() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            return 0
        fi
    fi
    # PIDファイルがなくてもポートで確認
    if lsof -i :3001 > /dev/null 2>&1; then
        return 0
    fi
    return 1
}

# サーバーを起動
start_server() {
    if is_running; then
        osascript -e 'display notification "サーバーは既に実行中です" with title "Claude Code UI"'
        return
    fi

    cd "$PROJECT_DIR"

    # サーバーを起動（バックグラウンドで）
    nohup npm run server > "$LOG_FILE" 2>&1 &
    local pid=$!
    echo "$pid" > "$PID_FILE"

    # 起動を待つ
    sleep 2

    if is_running; then
        osascript -e 'display notification "サーバーを起動しました (Port 3001)" with title "Claude Code UI"'
    else
        osascript -e 'display notification "サーバーの起動に失敗しました" with title "Claude Code UI"'
    fi
}

# サーバーを停止
stop_server() {
    if ! is_running; then
        osascript -e 'display notification "サーバーは実行されていません" with title "Claude Code UI"'
        rm -f "$PID_FILE"
        return
    fi

    # PIDファイルから停止
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            kill -TERM "$pid" 2>/dev/null
            # 子プロセスも停止
            pkill -TERM -P "$pid" 2>/dev/null
        fi
        rm -f "$PID_FILE"
    fi

    # ポート3001を使用しているプロセスも停止
    local port_pid=$(lsof -ti :3001 2>/dev/null)
    if [ -n "$port_pid" ]; then
        kill -TERM $port_pid 2>/dev/null
    fi

    sleep 1

    if ! is_running; then
        osascript -e 'display notification "サーバーを停止しました" with title "Claude Code UI"'
    else
        # 強制終了
        if [ -n "$port_pid" ]; then
            kill -9 $port_pid 2>/dev/null
        fi
        osascript -e 'display notification "サーバーを強制停止しました" with title "Claude Code UI"'
    fi
}

# ブラウザで開く
open_browser() {
    if is_running; then
        open "http://localhost:3001"
    else
        osascript -e 'display notification "サーバーが起動していません" with title "Claude Code UI"'
    fi
}

# ログを表示
show_logs() {
    if [ -f "$LOG_FILE" ]; then
        open -a Console "$LOG_FILE"
    else
        osascript -e 'display notification "ログファイルがありません" with title "Claude Code UI"'
    fi
}

# メニューを表示
show_menu() {
    local status_text
    local status_icon

    if is_running; then
        status_text="● 実行中 (Port 3001)"
        status_icon="🟢"
    else
        status_text="○ 停止中"
        status_icon="⚫"
    fi

    local choice=$(osascript << EOF
tell application "System Events"
    activate
    set menuItems to {"$status_icon $status_text", "---", "▶ サーバーを起動", "⏹ サーバーを停止", "🔄 再起動", "---", "🌐 ブラウザで開く", "📋 ログを表示", "---", "❌ メニューを終了"}
    choose from list menuItems with prompt "Claude Code UI" default items {}
end tell
EOF
)

    case "$choice" in
        *"サーバーを起動"*)
            start_server
            ;;
        *"サーバーを停止"*)
            stop_server
            ;;
        *"再起動"*)
            stop_server
            sleep 2
            start_server
            ;;
        *"ブラウザで開く"*)
            open_browser
            ;;
        *"ログを表示"*)
            show_logs
            ;;
        *"メニューを終了"*)
            exit 0
            ;;
    esac
}

# メインループ
while true; do
    show_menu
    sleep 0.5
done
MAINSCRIPT

chmod +x "$APP_DIR/Contents/MacOS/menubar"

# プロジェクトディレクトリを保存
echo "$PROJECT_DIR" > "$APP_DIR/Contents/Resources/project_dir.txt"

# PNG アイコンがあればコピー
if [ -f "$PROJECT_DIR/public/icons/icon-512x512.png" ]; then
    cp "$PROJECT_DIR/public/icons/icon-512x512.png" "$APP_DIR/Contents/Resources/AppIcon.png" 2>/dev/null || true
fi

echo ""
echo "✅ メニューバーアプリを作成しました: $APP_DIR"
echo ""
echo "使い方:"
echo "  1. '$APP_DIR' をダブルクリック"
echo "  2. メニューが表示され、サーバーの起動/停止を制御できます"
echo ""
echo "オプション:"
echo "  - ログイン時に自動起動: システム設定 > ログイン項目 に追加"
echo ""

#!/bin/bash
# macOS ネイティブメニューバーアプリを作成するスクリプト
# SwiftUIでメニューバーに常駐し、サーバーの起動/停止を制御
# 使用方法: ./scripts/create-native-menubar-app.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
APP_NAME="ClaudeCodeUI"
BUILD_DIR="/tmp/ClaudeCodeUIMenuBar"
APP_DIR="$HOME/Applications/${APP_NAME}.app"

echo "🔨 Building native macOS menubar app..."

# ビルドディレクトリを作成
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# Swift ソースコードを作成
cat > "$BUILD_DIR/main.swift" << 'SWIFTCODE'
import Cocoa
import Foundation

class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem!
    var serverProcess: Process?
    let pidFile = "/tmp/claude-code-ui.pid"
    let logFile = "/tmp/claude-code-ui.log"
    let tunnelPidFile = "/tmp/cloudflared-tunnel.pid"
    let tunnelLogFile = "/tmp/cloudflared-tunnel.log"
    var projectDir: String = ""
    var serverPort: Int = 3001  // デフォルトポート
    var statusCheckTimer: Timer?

    func log(_ message: String) {
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        let timestamp = dateFormatter.string(from: Date())
        let logMessage = "[\(timestamp)] \(message)\n"
        let debugLogPath = "/tmp/claude-code-ui-debug.log"
        if let handle = FileHandle(forWritingAtPath: debugLogPath) {
            handle.seekToEndOfFile()
            handle.write(logMessage.data(using: .utf8)!)
            handle.closeFile()
        } else {
            FileManager.default.createFile(atPath: debugLogPath, contents: logMessage.data(using: .utf8), attributes: nil)
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        log("App launching...")

        // プロジェクトディレクトリを取得
        let bundle = Bundle.main
        log("Getting project_dir from bundle...")
        if let configPath = bundle.path(forResource: "project_dir", ofType: "txt"),
           let dir = try? String(contentsOfFile: configPath, encoding: .utf8) {
            projectDir = dir.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        log("projectDir: \(projectDir)")

        if projectDir.isEmpty || !FileManager.default.fileExists(atPath: projectDir) {
            log("ERROR: Project directory not found")
            let alert = NSAlert()
            alert.messageText = "エラー"
            alert.informativeText = "Claude Code UIのプロジェクトディレクトリが見つかりません。"
            alert.alertStyle = .critical
            alert.runModal()
            NSApp.terminate(nil)
            return
        }

        // .envファイルからポート番号を読み取る
        log("Reading .env file...")
        let envPath = "\(projectDir)/.env"
        if let envContent = try? String(contentsOfFile: envPath, encoding: .utf8) {
            for line in envContent.components(separatedBy: .newlines) {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if trimmed.hasPrefix("PORT=") {
                    let portStr = trimmed.replacingOccurrences(of: "PORT=", with: "").trimmingCharacters(in: .whitespaces)
                    if let port = Int(portStr) {
                        serverPort = port
                    }
                    break
                }
            }
        }
        log("serverPort: \(serverPort)")

        // メニューバーアイテムを作成
        log("Creating status bar item...")
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        if let button = statusItem.button {
            button.title = "☁️"
        }
        log("Status bar item created")

        log("Calling updateMenu()...")
        updateMenu()
        log("updateMenu() completed")

        // 定期的にステータスをチェック
        log("Setting up timer...")
        statusCheckTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            self?.log("Timer fired, updating menu...")
            self?.updateMenu()
        }
        log("App launch completed")
    }

    func applicationWillTerminate(_ notification: Notification) {
        // アプリ終了時にサーバーも停止
        stopServer(showNotification: false)
        statusCheckTimer?.invalidate()
    }

    func updateMenu() {
        let menu = NSMenu()

        let isRunning = isServerRunning()
        let statusText = isRunning ? "● 実行中 (Port \(serverPort))" : "○ 停止中"

        // ステータス表示
        let statusItem = NSMenuItem(title: statusText, action: nil, keyEquivalent: "")
        statusItem.isEnabled = false
        menu.addItem(statusItem)

        menu.addItem(NSMenuItem.separator())

        // 起動/停止ボタン
        if isRunning {
            let stopItem = NSMenuItem(title: "⏹ サーバーを停止", action: #selector(stopServerAction), keyEquivalent: "s")
            stopItem.target = self
            menu.addItem(stopItem)
        } else {
            let startItem = NSMenuItem(title: "▶ サーバーを起動", action: #selector(startServerAction), keyEquivalent: "r")
            startItem.target = self
            menu.addItem(startItem)
        }

        let restartItem = NSMenuItem(title: "🔄 再起動", action: #selector(restartServerAction), keyEquivalent: "")
        restartItem.target = self
        restartItem.isEnabled = isRunning
        menu.addItem(restartItem)

        menu.addItem(NSMenuItem.separator())

        // ブラウザで開く
        let openItem = NSMenuItem(title: "🌐 ブラウザで開く", action: #selector(openBrowser), keyEquivalent: "o")
        openItem.target = self
        openItem.isEnabled = isRunning
        menu.addItem(openItem)

        // ログを表示
        let logItem = NSMenuItem(title: "📋 ログを表示", action: #selector(showLogs), keyEquivalent: "l")
        logItem.target = self
        menu.addItem(logItem)

        menu.addItem(NSMenuItem.separator())

        // 終了
        let quitItem = NSMenuItem(title: "❌ 終了", action: #selector(quitApp), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        self.statusItem.menu = menu

        // アイコンを更新
        if let button = self.statusItem.button {
            button.title = isRunning ? "☁️" : "💤"
        }
    }

    func isServerRunning() -> Bool {
        log("isServerRunning() called")

        // PIDファイルをチェック
        log("Checking PID file...")
        if FileManager.default.fileExists(atPath: pidFile),
           let pidString = try? String(contentsOfFile: pidFile, encoding: .utf8),
           let pid = Int32(pidString.trimmingCharacters(in: .whitespacesAndNewlines)) {
            log("PID file found, pid: \(pid)")
            // プロセスが存在するか確認
            if kill(pid, 0) == 0 {
                log("Process exists, returning true")
                return true
            }
            log("Process does not exist")
        } else {
            log("No PID file found")
        }

        // 設定されたポートをチェック
        log("Checking port \(serverPort) with lsof...")
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        task.arguments = ["-i", ":\(serverPort)", "-t"]
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = FileHandle.nullDevice

        do {
            log("Running lsof...")
            try task.run()
            log("Waiting for lsof to exit...")
            task.waitUntilExit()
            log("lsof exited")
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            if let output = String(data: data, encoding: .utf8), !output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                log("Port is in use, returning true")
                return true
            }
            log("Port is not in use")
        } catch {
            log("lsof error: \(error)")
        }

        log("isServerRunning() returning false")
        return false
    }

    @objc func startServerAction() {
        startServer()
    }

    func startServer() {
        log("startServer() called")

        if isServerRunning() {
            showNotification(title: "Claude Code UI", message: "サーバーは既に実行中です")
            return
        }

        // npm run server を実行
        log("Preparing to start server...")
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/bash")

        // npmのパスを明示的に指定（nodenv/nvm環境対応）
        // npm run dev でサーバーとクライアント両方を起動
        let command = "export PATH=\"$HOME/.nodenv/shims:$HOME/.nodenv/bin:$HOME/.nvm/versions/node/*/bin:/usr/local/bin:/opt/homebrew/bin:$PATH\"; cd '\(projectDir)' && npm run dev >> '\(logFile)' 2>&1 & echo $! > '\(pidFile)'"
        log("Command: \(command)")

        task.arguments = ["-c", command]
        task.currentDirectoryURL = URL(fileURLWithPath: projectDir)
        task.standardOutput = FileHandle.nullDevice
        task.standardError = FileHandle.nullDevice

        do {
            log("Running task...")
            try task.run()
            log("Task launched (not waiting)")

            // Cloudflare Tunnelも起動
            self.startTunnel()

            // 少し待ってからステータス更新
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { [weak self] in
                self?.log("Checking server status after delay...")
                self?.updateMenu()
                if self?.isServerRunning() == true {
                    self?.log("Server started successfully")
                    self?.showNotification(title: "Claude Code UI", message: "サーバーを起動しました (Port \(self?.serverPort ?? 3001))")
                } else {
                    self?.log("Server failed to start")
                    // ログファイルの内容を確認
                    if let logContent = try? String(contentsOfFile: self?.logFile ?? "", encoding: .utf8) {
                        let lastLines = logContent.components(separatedBy: .newlines).suffix(10).joined(separator: "\n")
                        self?.log("Server log (last 10 lines):\n\(lastLines)")
                    }
                    self?.showNotification(title: "Claude Code UI", message: "サーバーの起動に失敗しました")
                }
            }
        } catch {
            log("Task error: \(error)")
            showNotification(title: "Claude Code UI", message: "サーバーの起動に失敗しました: \(error.localizedDescription)")
        }
    }

    func startTunnel() {
        log("startTunnel() called")

        // cloudflaredのパスを探す
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/bash")
        let command = "export PATH=\"/usr/local/bin:/opt/homebrew/bin:$PATH\"; cloudflared tunnel run >> '\(tunnelLogFile)' 2>&1 & echo $! > '\(tunnelPidFile)'"
        log("Tunnel command: \(command)")

        task.arguments = ["-c", command]
        task.standardOutput = FileHandle.nullDevice
        task.standardError = FileHandle.nullDevice

        do {
            try task.run()
            log("Tunnel launched")
        } catch {
            log("Tunnel error: \(error)")
        }
    }

    func stopTunnel() {
        log("stopTunnel() called")

        // PIDファイルから停止
        if FileManager.default.fileExists(atPath: tunnelPidFile),
           let pidString = try? String(contentsOfFile: tunnelPidFile, encoding: .utf8),
           let pid = Int32(pidString.trimmingCharacters(in: .whitespacesAndNewlines)) {
            log("Stopping tunnel pid: \(pid)")
            kill(pid, SIGTERM)
        }

        // cloudflaredプロセスを停止
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        task.arguments = ["-f", "cloudflared tunnel"]
        try? task.run()
        task.waitUntilExit()

        try? FileManager.default.removeItem(atPath: tunnelPidFile)
        log("Tunnel stopped")
    }

    @objc func stopServerAction() {
        stopServer(showNotification: true)
    }

    func stopServer(showNotification notify: Bool) {
        if !isServerRunning() {
            if notify {
                showNotification(title: "Claude Code UI", message: "サーバーは実行されていません")
            }
            try? FileManager.default.removeItem(atPath: pidFile)
            return
        }

        // PIDファイルからプロセスを停止
        if FileManager.default.fileExists(atPath: pidFile),
           let pidString = try? String(contentsOfFile: pidFile, encoding: .utf8),
           let pid = Int32(pidString.trimmingCharacters(in: .whitespacesAndNewlines)) {
            kill(pid, SIGTERM)

            // 子プロセスも停止
            let task = Process()
            task.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
            task.arguments = ["-TERM", "-P", String(pid)]
            try? task.run()
            task.waitUntilExit()
        }

        // 設定されたポートのプロセスも停止
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        task.arguments = ["-ti", ":\(serverPort)"]
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = FileHandle.nullDevice

        do {
            try task.run()
            task.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            if let pids = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines), !pids.isEmpty {
                for pidStr in pids.components(separatedBy: .newlines) {
                    if let pid = Int32(pidStr) {
                        kill(pid, SIGTERM)
                    }
                }
            }
        } catch {
            // エラーは無視
        }

        try? FileManager.default.removeItem(atPath: pidFile)

        // Tunnelも停止
        stopTunnel()

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            self?.updateMenu()
            if notify {
                self?.showNotification(title: "Claude Code UI", message: "サーバーを停止しました")
            }
        }
    }

    @objc func restartServerAction() {
        stopServer(showNotification: false)
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
            self?.startServer()
        }
    }

    @objc func openBrowser() {
        if isServerRunning() {
            if let url = URL(string: "http://localhost:\(serverPort)") {
                NSWorkspace.shared.open(url)
            }
        } else {
            showNotification(title: "Claude Code UI", message: "サーバーが起動していません")
        }
    }

    @objc func showLogs() {
        if FileManager.default.fileExists(atPath: logFile) {
            NSWorkspace.shared.open(URL(fileURLWithPath: logFile))
        } else {
            showNotification(title: "Claude Code UI", message: "ログファイルがありません")
        }
    }

    @objc func quitApp() {
        // アプリ終了時にサーバーも停止するか確認
        if isServerRunning() {
            let alert = NSAlert()
            alert.messageText = "Claude Code UI"
            alert.informativeText = "サーバーを停止してから終了しますか？"
            alert.addButton(withTitle: "停止して終了")
            alert.addButton(withTitle: "そのまま終了")
            alert.addButton(withTitle: "キャンセル")

            let response = alert.runModal()
            switch response {
            case .alertFirstButtonReturn:
                stopServer(showNotification: false)
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                    NSApp.terminate(nil)
                }
            case .alertSecondButtonReturn:
                NSApp.terminate(nil)
            default:
                return
            }
        } else {
            NSApp.terminate(nil)
        }
    }

    func showNotification(title: String, message: String) {
        // 通知を表示（osascript経由でモダンな通知を使用）
        let script = "display notification \"\(message)\" with title \"\(title)\""
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        task.arguments = ["-e", script]
        try? task.run()
    }
}

// メインエントリポイント
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
SWIFTCODE

# コンパイル
echo "📦 Compiling Swift code..."
swiftc -o "$BUILD_DIR/$APP_NAME" \
    -framework Cocoa \
    -framework Foundation \
    "$BUILD_DIR/main.swift"

# .app構造を作成
echo "📁 Creating app bundle..."
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

# バイナリをコピー
cp "$BUILD_DIR/$APP_NAME" "$APP_DIR/Contents/MacOS/"

# Info.plist を作成
cat > "$APP_DIR/Contents/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>ClaudeCodeUI</string>
    <key>CFBundleIdentifier</key>
    <string>com.siteboon.claude-code-ui-menubar</string>
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
    <key>LSUIElement</key>
    <true/>
</dict>
</plist>
EOF

# プロジェクトディレクトリを保存
echo "$PROJECT_DIR" > "$APP_DIR/Contents/Resources/project_dir.txt"

# アイコンをコピー（存在する場合）
if [ -f "$PROJECT_DIR/public/icons/icon-512x512.png" ]; then
    cp "$PROJECT_DIR/public/icons/icon-512x512.png" "$APP_DIR/Contents/Resources/AppIcon.png" 2>/dev/null || true
fi

# ビルドディレクトリをクリーンアップ
rm -rf "$BUILD_DIR"

echo ""
echo "✅ メニューバーアプリを作成しました: $APP_DIR"
echo ""
echo "機能:"
echo "  ☁️ - メニューバーにアイコンが表示されます"
echo "  💤 - サーバー停止中はこのアイコンになります"
echo ""
echo "使い方:"
echo "  1. '$APP_DIR' を開くか、以下を実行:"
echo "     open '$APP_DIR'"
echo ""
echo "  2. メニューバーのアイコンをクリックしてサーバーを制御"
echo ""
echo "オプション:"
echo "  - ログイン時に自動起動: システム設定 > 一般 > ログイン項目 に追加"
echo ""

# アプリを起動するか確認
read -p "アプリを今すぐ起動しますか？ (y/N): " answer
if [[ "$answer" =~ ^[Yy]$ ]]; then
    open "$APP_DIR"
fi

# Cloudflare Tunnel & Access セットアップガイド

Claude Code UIを安全に外部公開するためのCloudflare TunnelとCloudflare Accessの設定手順。

## 目次
- [概要](#概要)
- [前提条件](#前提条件)
- [Cloudflare Tunnel セットアップ](#cloudflare-tunnel-セットアップ)
- [Cloudflare Access セキュリティ設定](#cloudflare-access-セキュリティ設定)
- [環境変数設定](#環境変数設定)
- [一括起動（UI + Tunnel）](#一括起動ui--tunnel)
- [macOSでの画面ロック対策](#macosでの画面ロック対策)
- [トラブルシューティング](#トラブルシューティング)

---

## 概要

### アーキテクチャ

```
インターネット
    ↓
Cloudflare CDN
    ↓
Cloudflare Access (認証レイヤー)
    ↓
Cloudflare Tunnel (暗号化トンネル)
    ↓
localhost:5173 (Vite) ← Claude Code UI
localhost:3030 (Express) ← API Server
```

### 主な機能
- **Cloudflare Tunnel**: ローカルサーバーを安全に外部公開（ポート開放不要）
- **Cloudflare Access**: ゼロトラスト認証でアクセス制御
- **暗号化通信**: すべての通信がCloudflareネットワーク経由で暗号化

---

## 前提条件

- Cloudflareアカウント（無料プランで可）
- カスタムドメインまたはCloudflareが提供する `*.trycloudflare.com` ドメイン
- `cloudflared` CLIのインストール

### cloudflared インストール

**macOS (Homebrew):**
```bash
brew install cloudflare/cloudflare/cloudflared
```

**Linux:**
```bash
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
sudo mv cloudflared-linux-amd64 /usr/local/bin/cloudflared
sudo chmod +x /usr/local/bin/cloudflared
```

**Windows:**
```powershell
# chocolatey
choco install cloudflared

# または手動ダウンロード
# https://github.com/cloudflare/cloudflared/releases
```

---

## Cloudflare Tunnel セットアップ

### 1. Cloudflare認証

```bash
cloudflared tunnel login
```

ブラウザが開き、Cloudflareアカウントでログイン。対象のドメインを選択。

### 2. Tunnelを作成

```bash
cloudflared tunnel create claudeui
```

トンネルIDが発行されます（例: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`）

### 3. DNS設定

カスタムドメインを使用する場合:

```bash
cloudflared tunnel route dns claudeui claudui.soujikibuild.com
```

または、Cloudflare Dashboardで手動設定:
- **Type**: `CNAME`
- **Name**: `claudui`
- **Target**: `<tunnel-id>.cfargotunnel.com`
- **Proxy**: オン (オレンジクラウド)

### 4. 設定ファイル作成

`~/.cloudflared/config.yml` を作成:

```yaml
tunnel: <your-tunnel-id>
credentials-file: /Users/<username>/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: claudui.soujikibuild.com
    service: http://localhost:5173
  - service: http_status:404
```

**ポイント:**
- `tunnel`: 手順2で取得したトンネルID
- `hostname`: あなたのカスタムドメイン
- `service`: Viteの開発サーバーポート（デフォルト: 5173）

### 5. Tunnelを起動

```bash
cloudflared tunnel run claudeui
```

または、バックグラウンド実行:

```bash
cloudflared tunnel run claudeui &
```

### 6. 動作確認

ブラウザで `https://claudui.soujikibuild.com` にアクセス。

**エラーが出る場合:**
- Vite開発サーバーが起動しているか確認: `npm run dev`
- `.env` の `VITE_ALLOWED_HOSTS` にドメインが設定されているか確認

---

## Cloudflare Access セキュリティ設定

### なぜCloudflare Accessが必要か？

Cloudflare Tunnelだけでは、URLを知っている人なら誰でもアクセス可能です。
Cloudflare Accessを使うと、認証済みユーザーのみアクセスを許可できます。

### 1. Zero Trust ダッシュボードにアクセス

```
https://one.dash.cloudflare.com/
```

### 2. アプリケーションを追加

1. 左サイドバー: **Access** → **Applications**
2. **Add an application** をクリック
3. **Self-hosted** を選択

### 3. アプリケーション設定

**Application Configuration:**
- **Application name**: `Claude Code UI`
- **Session Duration**: `24 hours`（お好みで調整）
- **Application domain**:
  - **Subdomain**: `claudui`
  - **Domain**: `soujikibuild.com`

**Application Appearance (オプション):**
- **App Launcher visibility**: `Visible` (ダッシュボードに表示)
- **Logo**: お好みでアップロード

### 4. ポリシーを作成

**Add a Policy:**

**Policy name**: `Allow Authorized Users`

**Action**: `Allow`

**Configure rules:**

**Include ルール（以下のいずれか）:**

#### Option A: 特定のメールアドレスのみ許可
- **Selector**: `Emails`
- **Value**: `your-email@example.com`

#### Option B: 特定のドメインのメールすべて許可
- **Selector**: `Emails ending in`
- **Value**: `@yourcompany.com`

#### Option C: 特定のログイン方法
- **Selector**: `Login Methods`
- **Value**: `Google` / `GitHub` など

**複数条件の組み合わせ例:**
```
Include:
  - Emails: user1@example.com
  - Emails: user2@example.com

Exclude (オプション):
  - IP ranges: 192.168.1.0/24 (社内ネットワークは除外)
```

### 5. 認証方法の設定

初回のみ、Login Methodsを有効化:

1. **Settings** → **Authentication** (または **Access** → **Authentication**)
2. **Login methods** タブ
3. 使用する認証方法を **Add new** で追加:

**推奨オプション:**

#### One-time PIN (デフォルトで有効)
- メールでOTPコードを受信
- 設定不要

#### Google
1. **Add new** → **Google**
2. Google OAuth設定が必要（ガイドあり）
3. 許可するGoogleアカウントのドメインを指定

#### GitHub
1. **Add new** → **GitHub**
2. GitHub OAuth Appを作成
3. Client IDとSecretを入力

### 6. 保存して完了

**Save application** をクリック。

### 7. アクセステスト

1. ブラウザで `https://claudui.soujikibuild.com` にアクセス
2. Cloudflare Accessのログイン画面が表示される
3. 設定した認証方法でログイン（例: メールでOTP受信）
4. 認証成功後、Claude Code UIにアクセス可能

---

## 環境変数設定

`.env` ファイルに以下を追加:

```bash
# Cloudflare Tunnel用の許可ホスト設定
# カンマ区切りで複数ドメイン指定可能
VITE_ALLOWED_HOSTS=claudui.soujikibuild.com

# 開発サーバーポート（Tunnelのserviceと一致させる）
VITE_PORT=5173
PORT=3030
```

**複数ドメインを許可する場合:**
```bash
VITE_ALLOWED_HOSTS=claudui.soujikibuild.com,dev.example.com,staging.example.com
```

**設定の反映:**

Vite開発サーバーを再起動:
```bash
npm run dev
```

---

## 一括起動（UI + Tunnel）

Claude Code UIとCloudflare Tunnelを同時に起動する方法。

### 方法1: npmスクリプト（ターミナル）

```bash
npm run dev:tunnel
```

これで以下が同時に起動します:
- Express APIサーバー (port 3030)
- Vite開発サーバー (port 5173)
- Cloudflare Tunnel（caffeinate付きでスリープ防止）

**停止:** `Ctrl+C` ですべて終了

### 方法2: macOSアプリ（デスクトップアイコン）

デスクトップにアプリアイコンを作成:

```bash
./scripts/create-macos-app.sh
```

作成後:
1. デスクトップに「Claude Code UI」アイコンが表示される
2. ダブルクリックでTerminalが開き、自動起動
3. **Dockに追加**: アイコンをDockにドラッグ
4. **ログイン時自動起動**: システム設定 → ログイン項目 に追加

### 方法3: シェルスクリプト

```bash
./scripts/start-with-tunnel.sh
```

---

## トラブルシューティング

### 1. "Blocked request. This host is not allowed" エラー

**原因:** Viteの `server.allowedHosts` にドメインが設定されていない

**解決策:**
1. `.env` に `VITE_ALLOWED_HOSTS=your-domain.com` を追加
2. Vite開発サーバーを再起動: `npm run dev`
3. Cloudflare Tunnelを再起動: `cloudflared tunnel run claudeui`

### 2. Tunnelが起動しない

**確認事項:**
- `~/.cloudflared/config.yml` のパスが正しいか
- `tunnel` IDが正しいか
- `credentials-file` のパスが正しいか
- Vite開発サーバーが起動しているか: `lsof -i :5173`

**デバッグ:**
```bash
cloudflared tunnel run claudeui --loglevel debug
```

### 3. Cloudflare Accessのログイン画面が出ない

**確認事項:**
- Applicationが正しく作成されているか
- Application domainがTunnelのhostnameと一致しているか
- Policyが `Allow` アクションになっているか
- Login Methodsが有効化されているか

**キャッシュクリア:**
- ブラウザのキャッシュとCookieをクリア
- シークレットモード/プライベートブラウジングで試す

### 4. 認証後もアクセスできない

**確認事項:**
- Policyの Include ルールにあなたのメールアドレスが含まれているか
- Session Durationが切れていないか
- Cloudflare Accessの Application Logsでエラーを確認:
  - **Access** → **Applications** → 該当アプリ → **Logs**

### 5. WebSocketが動作しない

**原因:** Cloudflare TunnelはデフォルトでWebSocketをサポート

**確認:**
- `config.yml` の `service` が `http://localhost:5173` になっているか（`ws://` ではない）
- Cloudflareが自動でWebSocketをアップグレード

---

## セキュリティのベストプラクティス

### 1. 最小権限の原則
- 必要な人だけにアクセスを許可
- Policyで細かくルールを設定

### 2. Session Durationの設定
- 長期間使わない場合は短めに設定（例: 4 hours）
- 頻繁にアクセスする場合は長めでも可（例: 24 hours）

### 3. 監査ログの確認
- **Access** → **Applications** → **Logs** で誰がいつアクセスしたか確認

### 4. 2要素認証の強制
- Login Methodsで2FA対応の認証方法を使用（Google, GitHub）

### 5. IP制限の追加（オプション）
- 特定のIPレンジからのみアクセスを許可
- Policy の **Include** に `IP ranges` を追加

### 6. 定期的なアクセス権の見直し
- 不要になったユーザーをPolicyから削除
- Session の有効期限を確認

---

## systemdでの自動起動（Linux）

永続的にTunnelを起動する場合:

`/etc/systemd/system/cloudflared.service` を作成:

```ini
[Unit]
Description=Cloudflare Tunnel
After=network.target

[Service]
Type=simple
User=your-username
ExecStart=/usr/local/bin/cloudflared tunnel run claudeui
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

有効化と起動:
```bash
sudo systemctl daemon-reload
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
sudo systemctl status cloudflared
```

---

## macOSでの画面ロック対策

macOSでは画面ロックやスリープ時にCloudflare Tunnelの接続が切れることがあります。以下のエラーが発生する場合:

```
ERR failed to accept incoming stream requests error="failed to accept QUIC stream: timeout: no recent network activity"
```

### 方法1: caffeinate コマンド（開発用推奨）

`caffeinate` を使用してスリープを防止しながらTunnelを起動:

```bash
caffeinate -s -i cloudflared tunnel run claudeui
```

**オプション説明:**
- `-s`: AC電源接続時のシステムスリープを防止
- `-i`: アイドル時のスリープを防止

**バックグラウンド実行:**
```bash
nohup caffeinate -s -i cloudflared tunnel run claudeui > /tmp/cloudflared.log 2>&1 &
```

### 方法2: 電源管理設定の変更

システムの電源管理設定を調整:

```bash
# ネットワーク接続を維持（推奨）
sudo pmset -a tcpkeepalive 1

# Power Napを有効化（バックグラウンドタスク継続）
sudo pmset -a powernap 1

# スリープを無効化（オプション）
sudo pmset -a sleep 0
sudo pmset -a displaysleep 0
```

**現在の設定確認:**
```bash
pmset -g
```

**設定を元に戻す場合:**
```bash
sudo pmset -a sleep 1
sudo pmset -a displaysleep 10
```

### 方法3: システムサービスとしてインストール（本番用推奨）

cloudflaredをシステムサービスとしてインストールすると、画面ロックの影響を受けません:

```bash
sudo cloudflared service install
sudo launchctl start com.cloudflare.cloudflared
```

**サービス状態確認:**
```bash
sudo launchctl list | grep cloudflare
```

**サービス停止:**
```bash
sudo launchctl stop com.cloudflare.cloudflared
```

**サービスアンインストール:**
```bash
sudo cloudflared service uninstall
```

---

## macOS LaunchAgentでの自動起動（カスタム設定）

`~/Library/LaunchAgents/com.cloudflare.tunnel.plist` を作成:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.cloudflare.tunnel</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/cloudflared</string>
        <string>tunnel</string>
        <string>run</string>
        <string>claudeui</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

読み込みと起動:
```bash
launchctl load ~/Library/LaunchAgents/com.cloudflare.tunnel.plist
launchctl start com.cloudflare.tunnel
```

---

## 参考リンク

- [Cloudflare Tunnel公式ドキュメント](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)
- [Cloudflare Access公式ドキュメント](https://developers.cloudflare.com/cloudflare-one/applications/)
- [cloudflared GitHub](https://github.com/cloudflare/cloudflared)
- [Zero Trust Dashboard](https://one.dash.cloudflare.com/)

---

## まとめ

このセットアップにより:

✅ ローカル環境を安全に外部公開（ポート開放不要）
✅ 認証済みユーザーのみアクセス可能
✅ すべての通信が暗号化
✅ アクセスログで監査可能
✅ 無料で利用可能（Cloudflare Free Plan）

セキュリティと利便性を両立した、本番環境レベルのアクセス制御が実現できます。

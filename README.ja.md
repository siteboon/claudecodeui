<div align="center">
  <img src="public/logo.svg" alt="CloudCLI UI" width="64" height="64">
  <h1>Cloud CLI（別名 Claude Code UI）</h1>
  <p><a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a>、<a href="https://docs.cursor.com/en/cli/overview">Cursor CLI</a>、<a href="https://developers.openai.com/codex">Codex</a>、<a href="https://geminicli.com/">Gemini-CLI</a> のためのデスクトップ／モバイル UI。<br>ローカルでもリモートでも使え、アクティブなプロジェクトとセッションをどこからでも閲覧できます。</p>
</div>

<p align="center">
  <a href="https://cloudcli.ai">CloudCLI Cloud</a> · <a href="https://cloudcli.ai/docs">ドキュメント</a> · <a href="https://discord.gg/buxwujPNRE">Discord</a> · <a href="https://github.com/siteboon/claudecodeui/issues">バグ報告</a> · <a href="CONTRIBUTING.md">コントリビュート</a>
</p>

<p align="center">
  <a href="https://cloudcli.ai"><img src="https://img.shields.io/badge/☁️_CloudCLI_Cloud-Try_Now-0066FF?style=for-the-badge" alt="CloudCLI Cloud"></a>
  <a href="https://discord.gg/buxwujPNRE"><img src="https://img.shields.io/badge/Discord-Join%20Community-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Join our Discord"></a>
  <br><br>
  <a href="https://trendshift.io/repositories/15586" target="_blank"><img src="https://trendshift.io/api/badge/repositories/15586" alt="siteboon%2Fclaudecodeui | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<div align="right"><i><a href="./README.md">English</a> · <a href="./README.ru.md">Русский</a> · <a href="./README.de.md">Deutsch</a> · <a href="./README.ko.md">한국어</a> · <a href="./README.zh-CN.md">中文</a> · <b>日本語</b></i></div>

---

## スクリーンショット

<div align="center">

<table>
<tr>
<td align="center">
<h3>デスクトップビュー</h3>
<img src="public/screenshots/desktop-main.png" alt="Desktop Interface" width="400">
<br>
<em>プロジェクト概要とチャットを表示するメイン画面</em>
</td>
<td align="center">
<h3>モバイル体験</h3>
<img src="public/screenshots/mobile-chat.png" alt="Mobile Interface" width="250">
<br>
<em>タッチ操作に対応したレスポンシブなモバイルデザイン</em>
</td>
</tr>
<tr>
<td align="center" colspan="2">
<h3>CLI 選択</h3>
<img src="public/screenshots/cli-selection.png" alt="CLI Selection" width="400">
<br>
<em>Claude Code、Gemini、Cursor CLI、Codex から選択</em>
</td>
</tr>
</table>



</div>

## 機能

- **レスポンシブデザイン** - デスクトップ／タブレット／モバイルでシームレスに動作し、モバイルからも Agents を利用可能
- **インタラクティブチャット UI** - Agents とスムーズにやり取りできる内蔵チャット UI
- **統合シェルターミナル** - 内蔵シェル機能で Agents の CLI に直接アクセス
- **ファイルエクスプローラー** - シンタックスハイライトとライブ編集に対応したインタラクティブなファイルツリー
- **Git エクスプローラー** - 変更の表示、ステージ、コミット。ブランチ切り替えも可能
- **セッション管理** - 会話の再開、複数セッションの管理、履歴の追跡
- **プラグインシステム** - カスタムプラグインで CloudCLI を拡張 — 新しいタブ、バックエンドサービス、連携を追加できます。[Build your own →](https://github.com/cloudcli-ai/cloudcli-plugin-starter)
- **TaskMaster AI 連携** *(オプション)* - AI によるタスク計画、PRD 解析、ワークフロー自動化を備えた高度なプロジェクト管理
- **モデル互換性** - Claude、GPT、Gemini の各モデルファミリーに対応（対応モデルの全リストは [`shared/modelConstants.js`](shared/modelConstants.js) を参照）


## クイックスタート

### CloudCLI Cloud（推奨）

最速で始める方法 — ローカルのセットアップは不要です。Web、モバイルアプリ、API、またはお気に入りの IDE からアクセスできる、フルマネージドでコンテナ化された開発環境を利用できます。

**[CloudCLI Cloud を始める](https://cloudcli.ai)**


### セルフホスト（オープンソース）

**npx** で今すぐ CloudCLI UI を試せます（**Node.js** v22+ が必要）：

```
npx @siteboon/claude-code-ui
```

または、普段使いするなら **グローバル** にインストール：

```
npm install -g @siteboon/claude-code-ui
cloudcli
```

`http://localhost:3001` を開いてください — 既存のセッションは自動的に検出されます。

より詳細な設定オプション、PM2、リモートサーバー設定などについては **[documentation →](https://cloudcli.ai/docs)** を参照してください。


---

## どちらの選択肢が適していますか？

CloudCLI UI は、CloudCLI Cloud を支えるオープンソースの UI レイヤーです。自分のマシンにセルフホストすることも、フルマネージドのクラウド環境、チーム機能、より深い統合を備えた CloudCLI Cloud を使うこともできます。

| | CloudCLI UI (Self-hosted) | CloudCLI Cloud |
|---|---|---|
| **Best for** | 自分のマシン上でローカルの agent セッションに対してフル UI を使いたい開発者 | クラウド上で動く agents をどこからでも利用したいチーム／開発者 |
| **How you access it** | ブラウザ（`[yourip]:port`） | ブラウザ、任意の IDE、REST API、n8n |
| **Setup** | `npx @siteboon/claude-code-ui` | セットアップ不要 |
| **Machine needs to stay on** | はい | いいえ |
| **Mobile access** | 同一ネットワーク内の任意のブラウザ | 任意のデバイス（ネイティブアプリも準備中） |
| **Sessions available** | `~/.claude` から全セッションを自動検出 | クラウド環境内の全セッション |
| **Agents supported** | Claude Code、Cursor CLI、Codex、Gemini CLI | Claude Code、Cursor CLI、Codex、Gemini CLI |
| **File explorer and Git** | はい（UI に内蔵） | はい（UI に内蔵） |
| **MCP configuration** | UI で管理し、ローカルの `~/.claude` 設定と同期 | UI で管理 |
| **IDE access** | ローカル IDE | クラウド環境に接続された任意の IDE |
| **REST API** | はい | はい |
| **n8n node** | いいえ | はい |
| **Team sharing** | いいえ | はい |
| **Platform cost** | 無料（オープンソース） | 月 $7〜 |

> どちらの選択肢でも、AI のサブスクリプション（Claude、Cursor など）はご自身のものを使用します — CloudCLI が提供するのは環境であり、AI そのものではありません。

---

## セキュリティとツール設定

**🔒 Important Notice**: すべての Claude Code ツールは **デフォルトで無効** です。これにより、潜在的に有害な操作が自動的に実行されることを防ぎます。

### ツールの有効化

Claude Code の全機能を使うには、手動でツールを有効化する必要があります：

1. **Open Tools Settings** - サイドバーの歯車アイコンをクリック
2. **Enable Selectively** - 必要なツールだけをオンにする
3. **Apply Settings** - 設定はローカルに保存されます

<div align="center">

![Tools Settings Modal](public/screenshots/tools-modal.png)
*Tools Settings interface - enable only what you need*

</div>

**Recommended approach**: まずは基本ツールだけを有効にし、必要に応じて追加してください。これらの設定は後からいつでも調整できます。

---

## プラグイン

CloudCLI にはプラグインシステムがあり、独自のフロントエンド UI と（必要に応じて）Node.js バックエンドを持つカスタムタブを追加できます。プラグインは **Settings > Plugins** から git リポジトリを直接指定してインストールするか、自作できます。

### 利用可能なプラグイン

| Plugin | Description |
|---|---|
| **[Project Stats](https://github.com/cloudcli-ai/cloudcli-plugin-starter)** | 現在のプロジェクトについて、ファイル数、コード行数、ファイル種別の内訳、最大ファイル、最近変更されたファイルを表示 |

### 自作する

**[Plugin Starter Template →](https://github.com/cloudcli-ai/cloudcli-plugin-starter)** — このリポジトリを fork して独自プラグインを作れます。フロントエンド描画、ライブコンテキスト更新、バックエンドサーバーへの RPC 通信を含む動作例が入っています。

**[プラグインのドキュメント →](https://cloudcli.ai/docs/plugin-overview)** — プラグイン API、manifest 形式、セキュリティモデルなどの完全ガイド。

---
## FAQ

<details>
<summary>Claude Code Remote Control とはどう違いますか？</summary>

Claude Code Remote Control は、ローカル端末で既に動作しているセッションへメッセージを送れる仕組みです。マシンを起動したままにし、端末も開いたままにする必要があり、ネットワーク接続がない状態が約 10 分続くとセッションがタイムアウトします。

CloudCLI UI と CloudCLI Cloud は、Claude Code の横に別物として存在するのではなく、Claude Code を拡張します — MCP サーバー、権限、設定、セッションは Claude Code がネイティブに使うものと完全に同一です。複製したり、別系統で管理したりしません。

実際の意味合いは次のとおりです：

- **All your sessions, not just one** — CloudCLI UI auto-discovers every session from your `~/.claude` folder. Remote Control only exposes the single active session to make it available in the Claude mobile app.
- **Your settings are your settings** — MCP servers, tool permissions, and project config you change in CloudCLI UI are written directly to your Claude Code config and take effect immediately, and vice versa.
- **Works with more agents** — Claude Code, Cursor CLI, Codex, and Gemini CLI, not just Claude Code.
- **Full UI, not just a chat window** — file explorer, Git integration, MCP management, and a shell terminal are all built in.
- **CloudCLI Cloud runs in the cloud** — close your laptop, the agent keeps running. No terminal to babysit, no machine to keep awake.

</details>

<details>
<summary>AI のサブスクリプションは別途支払いが必要ですか？</summary>

はい。CloudCLI provides the environment, not the AI. You bring your own Claude, Cursor, Codex, or Gemini subscription. CloudCLI Cloud starts at $7/month for the hosted environment on top of that.

</details>

<details>
<summary>CloudCLI UI をスマホで使えますか？</summary>

はい。For self-hosted, run the server on your machine and open `[yourip]:port` in any browser on your network. For CloudCLI Cloud, open it from any device — no VPN, no port forwarding, no setup. A native app is also in the works.

</details>

<details>
<summary>UI で加えた変更はローカルの Claude Code 設定に影響しますか？</summary>

はい、for self-hosted. CloudCLI UI reads from and writes to the same `~/.claude` config that Claude Code uses natively. MCP servers you add via the UI show up in Claude Code immediately and vice versa.

</details>

---

## コミュニティとサポート

- **[Documentation](https://cloudcli.ai/docs)** — インストール、設定、機能、トラブルシューティング
- **[Discord](https://discord.gg/buxwujPNRE)** — ヘルプを得たり、ユーザー同士で交流したりできます
- **[GitHub Issues](https://github.com/siteboon/claudecodeui/issues)** — バグ報告と機能要望
- **[Contributing Guide](CONTRIBUTING.md)** — プロジェクトへの貢献方法

## ライセンス

GNU General Public License v3.0 - 詳細は [LICENSE](LICENSE) file for details.

This project is open source and free to use, modify, and distribute under the GPL v3 license.

## 謝辞

### 使用技術
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** - Anthropic's official CLI
- **[Cursor CLI](https://docs.cursor.com/en/cli/overview)** - Cursor's official CLI
- **[Codex](https://developers.openai.com/codex)** - OpenAI Codex
- **[Gemini-CLI](https://geminicli.com/)** - Google Gemini CLI
- **[React](https://react.dev/)** - User interface library
- **[Vite](https://vitejs.dev/)** - Fast build tool and dev server
- **[Tailwind CSS](https://tailwindcss.com/)** - Utility-first CSS framework
- **[CodeMirror](https://codemirror.net/)** - Advanced code editor
- **[TaskMaster AI](https://github.com/eyaltoledano/claude-task-master)** *(Optional)* - AI-powered project management and task planning


### スポンサー
- [Siteboon - AI powered website builder](https://siteboon.ai)
---

<div align="center">
  <strong>Claude Code、Cursor、Codex コミュニティのために心を込めて作りました。</strong>
</div>

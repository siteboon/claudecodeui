<div align="center">
  <img src="public/logo.svg" alt="Claude Code UI" width="64" height="64">
  <h1>Cloud CLI (別名 Claude Code UI)</h1>
</div>


[Claude Code](https://docs.anthropic.com/en/docs/claude-code)、[Cursor CLI](https://docs.cursor.com/en/cli/overview)、[Codex](https://developers.openai.com/codex) 向けのデスクトップ・モバイル UI です。ローカルまたはリモートで使用して、Claude Code、Cursor、Codex のアクティブなプロジェクトやセッションを確認し、どこからでも（モバイルやデスクトップから）変更を加えることができます。どこでも使える適切なインターフェースを提供します。

<div align="right"><i><a href="./README.md">English</a> · <a href="./README.ko.md">한국어</a> · <a href="./README.zh-CN.md">中文</a></i></div>

## スクリーンショット

<div align="center">

<table>
<tr>
<td align="center">
<h3>デスクトップビュー</h3>
<img src="public/screenshots/desktop-main.png" alt="Desktop Interface" width="400">
<br>
<em>プロジェクト概要とチャットを表示するメインインターフェース</em>
</td>
<td align="center">
<h3>モバイル体験</h3>
<img src="public/screenshots/mobile-chat.png" alt="Mobile Interface" width="250">
<br>
<em>タッチナビゲーション対応のレスポンシブモバイルデザイン</em>
</td>
</tr>
<tr>
<td align="center" colspan="2">
<h3>CLI 選択</h3>
<img src="public/screenshots/cli-selection.png" alt="CLI Selection" width="400">
<br>
<em>Claude Code、Cursor CLI、Codex から選択</em>
</td>
</tr>
</table>



</div>

## 機能

- **レスポンシブデザイン** - デスクトップ、タブレット、モバイルでシームレスに動作し、モバイルからも Claude Code、Cursor、Codex を使用可能
- **インタラクティブチャットインターフェース** - Claude Code、Cursor、Codex とシームレスに通信する組み込みチャットインターフェース
- **統合シェルターミナル** - 組み込みシェル機能による Claude Code、Cursor CLI、Codex への直接アクセス
- **ファイルエクスプローラー** - シンタックスハイライトとライブ編集対応のインタラクティブファイルツリー
- **Git エクスプローラー** - 変更の確認、ステージング、コミット。ブランチの切り替えも可能
- **セッション管理** - 会話の再開、複数セッションの管理、履歴の追跡
- **TaskMaster AI 統合** *（オプション）* - AI 駆動のタスク計画、PRD 解析、ワークフロー自動化による高度なプロジェクト管理
- **モデル互換性** - Claude Sonnet 4.5、Opus 4.5、GPT-5.2 に対応


## クイックスタート

### 前提条件

- [Node.js](https://nodejs.org/) v22 以上
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) のインストールと設定、および/または
- [Cursor CLI](https://docs.cursor.com/en/cli/overview) のインストールと設定、および/または
- [Codex](https://developers.openai.com/codex) のインストールと設定

### ワンクリック実行（推奨）

インストール不要、直接実行：

```bash
npx @siteboon/claude-code-ui
```

サーバーが起動し、`http://localhost:3001`（または設定した PORT）でアクセスできます。

**再起動**: サーバーを停止した後、同じ `npx` コマンドを再度実行するだけです
### グローバルインストール（定期的に使用する場合）

頻繁に使用する場合は、一度だけグローバルインストール：

```bash
npm install -g @siteboon/claude-code-ui
```

シンプルなコマンドで起動：

```bash
claude-code-ui
```


**再起動**: Ctrl+C で停止し、`claude-code-ui` を再度実行します。

**アップデート**:
```bash
cloudcli update
```

### CLI の使い方

グローバルインストール後、`claude-code-ui` と `cloudcli` コマンドが使用できます：

| コマンド / オプション | 短縮形 | 説明 |
|------------------|-------|-------------|
| `cloudcli` または `claude-code-ui` | | サーバーを起動（デフォルト） |
| `cloudcli start` | | サーバーを明示的に起動 |
| `cloudcli status` | | 設定とデータの場所を表示 |
| `cloudcli update` | | 最新バージョンに更新 |
| `cloudcli help` | | ヘルプ情報を表示 |
| `cloudcli version` | | バージョン情報を表示 |
| `--port <port>` | `-p` | サーバーポートを設定（デフォルト: 3001） |
| `--database-path <path>` | | カスタムデータベースの場所を設定 |

**例:**
```bash
cloudcli                          # デフォルト設定で起動
cloudcli -p 8080              # カスタムポートで起動
cloudcli status                   # 現在の設定を表示
```

### バックグラウンドサービスとして実行（本番環境推奨）

本番環境では、PM2（Process Manager 2）を使用して Claude Code UI をバックグラウンドサービスとして実行します：

#### PM2 のインストール

```bash
npm install -g pm2
```

#### バックグラウンドサービスとして起動

```bash
# バックグラウンドでサーバーを起動
pm2 start claude-code-ui --name "claude-code-ui"

# または短いエイリアスを使用
pm2 start cloudcli --name "claude-code-ui"

# カスタムポートで起動
pm2 start cloudcli --name "claude-code-ui" -- --port 8080
```


#### システム起動時の自動起動

システム起動時に Claude Code UI を自動的に起動するには：

```bash
# プラットフォーム用の起動スクリプトを生成
pm2 startup

# 現在のプロセスリストを保存
pm2 save
```


### ローカル開発インストール

1. **リポジトリをクローン:**
```bash
git clone https://github.com/siteboon/claudecodeui.git
cd claudecodeui
```

2. **依存関係をインストール:**
```bash
npm install
```

3. **環境を設定:**
```bash
cp .env.example .env
# お好みの設定で .env を編集
```

4. **アプリケーションを起動:**
```bash
# 開発モード（ホットリロード付き）
npm run dev

```
アプリケーションは .env で指定したポートで起動します

5. **ブラウザを開く:**
   - 開発: `http://localhost:3001`

## セキュリティとツール設定

**重要なお知らせ**: すべての Claude Code ツールは**デフォルトで無効**になっています。これにより、潜在的に有害な操作が自動的に実行されることを防ぎます。

### ツールの有効化

Claude Code の全機能を使用するには、手動でツールを有効にする必要があります：

1. **ツール設定を開く** - サイドバーの歯車アイコンをクリック
3. **選択的に有効化** - 必要なツールのみを有効にする
4. **設定を適用** - 環境設定はローカルに保存されます

<div align="center">

![ツール設定モーダル](public/screenshots/tools-modal.png)
*ツール設定インターフェース - 必要なものだけを有効にしましょう*

</div>

**推奨アプローチ**: 基本的なツールから有効にし、必要に応じて追加してください。これらの設定はいつでも調整できます。

## TaskMaster AI 統合 *（オプション）*

Claude Code UI は、高度なプロジェクト管理と AI 駆動のタスク計画のための **[TaskMaster AI](https://github.com/eyaltoledano/claude-task-master)**（別名 claude-task-master）統合をサポートしています。

提供機能
- PRD（製品要件ドキュメント）からの AI 駆動タスク生成
- スマートなタスク分解と依存関係管理
- ビジュアルタスクボードと進捗追跡

**セットアップとドキュメント**: インストール手順、設定ガイド、使用例は [TaskMaster AI GitHub リポジトリ](https://github.com/eyaltoledano/claude-task-master)をご覧ください。
インストール後、設定から有効にできます


## 使用ガイド

### 主要機能

#### プロジェクト管理
Claude Code、Cursor、Codex のセッションが利用可能な場合、自動的に検出しプロジェクトとしてグループ化します
- **プロジェクト操作** - プロジェクトの名前変更、削除、整理
- **スマートナビゲーション** - 最近のプロジェクトやセッションへのクイックアクセス
- **MCP サポート** - UI から独自の MCP サーバーを追加

#### チャットインターフェース
- **レスポンシブチャットまたは Claude Code/Cursor CLI/Codex CLI を使用** - アダプティブチャットインターフェースを使用するか、シェルボタンで選択した CLI に接続できます
- **リアルタイム通信** - WebSocket 接続で選択した CLI（Claude Code/Cursor/Codex）からレスポンスをストリーミング
- **セッション管理** - 以前の会話を再開、または新しいセッションを開始
- **メッセージ履歴** - タイムスタンプとメタデータ付きの完全な会話履歴
- **マルチフォーマット対応** - テキスト、コードブロック、ファイル参照

#### ファイルエクスプローラーとエディター
- **インタラクティブファイルツリー** - 展開/折りたたみナビゲーションでプロジェクト構造を閲覧
- **ライブファイル編集** - インターフェースで直接ファイルの読み取り、変更、保存
- **シンタックスハイライト** - 複数のプログラミング言語に対応
- **ファイル操作** - ファイルやディレクトリの作成、名前変更、削除

#### Git エクスプローラー


#### TaskMaster AI 統合 *（オプション）*
- **ビジュアルタスクボード** - 開発タスク管理のためのカンバンスタイルインターフェース
- **PRD パーサー** - 製品要件ドキュメントを作成し、構造化されたタスクに変換
- **進捗追跡** - リアルタイムのステータス更新と完了追跡

#### セッション管理
- **セッション永続化** - すべての会話を自動保存
- **セッション整理** - プロジェクトとタイムスタンプでセッションをグループ化
- **セッション操作** - 会話履歴の名前変更、削除、エクスポート
- **クロスデバイス同期** - どのデバイスからでもセッションにアクセス

### モバイルアプリ
- **レスポンシブデザイン** - すべての画面サイズに最適化
- **タッチフレンドリーインターフェース** - スワイプジェスチャーとタッチナビゲーション
- **モバイルナビゲーション** - 親指で操作しやすいボトムタブバー
- **アダプティブレイアウト** - 折りたたみ可能なサイドバーとスマートコンテンツ優先順位
- **ホーム画面にショートカットを追加** - ホーム画面にショートカットを追加すると、アプリが PWA のように動作します

## アーキテクチャ

### システム概要

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend       │    │  Agent     │
│   (React/Vite)  │◄──►│ (Express/WS)    │◄──►│  Integration    │
│                 │    │                 │    │                │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### バックエンド (Node.js + Express)
- **Express サーバー** - 静的ファイル配信付きの RESTful API
- **WebSocket サーバー** - チャットとプロジェクト更新のための通信
- **エージェント統合 (Claude Code / Cursor CLI / Codex)** - プロセスの生成と管理
- **ファイルシステム API** - プロジェクト向けファイルブラウザの公開

### フロントエンド (React + Vite)
- **React 18** - hooks を使用したモダンなコンポーネントアーキテクチャ
- **CodeMirror** - シンタックスハイライト対応の高度なコードエディター




### コントリビューション

コントリビューションを歓迎します！以下のガイドラインに従ってください：

#### はじめに
1. リポジトリを **Fork** する
2. Fork を **クローン**: `git clone <your-fork-url>`
3. 依存関係を **インストール**: `npm install`
4. フィーチャーブランチを **作成**: `git checkout -b feature/amazing-feature`

#### 開発プロセス
1. 既存のコードスタイルに従って **変更を加える**
2. **徹底的にテスト** - すべての機能が正しく動作することを確認
3. **品質チェックを実行**: `npm run lint && npm run format`
4. [Conventional Commits](https://conventionalcommits.org/) に従った説明的なメッセージで **コミット**
5. ブランチに **プッシュ**: `git push origin feature/amazing-feature`
6. 以下を含む **プルリクエストを提出**:
   - 変更内容の明確な説明
   - UI 変更の場合はスクリーンショット
   - 該当する場合はテスト結果

#### コントリビューション内容
- **バグ修正** - 安定性の向上に貢献
- **新機能** - 機能の強化（まず Issue で議論してください）
- **ドキュメント** - ガイドと API ドキュメントの改善
- **UI/UX の改善** - より良いユーザー体験
- **パフォーマンス最適化** - より高速に

## トラブルシューティング

### よくある問題と解決方法


#### 「Claude プロジェクトが見つかりません」
**問題**: UI にプロジェクトが表示されない、またはプロジェクトリストが空
**解決方法**:
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) が正しくインストールされていることを確認
- 少なくとも1つのプロジェクトディレクトリで `claude` コマンドを実行して初期化
- `~/.claude/projects/` ディレクトリが存在し、適切な権限があることを確認

#### ファイルエクスプローラーの問題
**問題**: ファイルが読み込まれない、権限エラー、空のディレクトリ
**解決方法**:
- プロジェクトディレクトリの権限を確認（ターミナルで `ls -la`）
- プロジェクトパスが存在しアクセス可能であることを確認
- 詳細なエラーメッセージについてはサーバーコンソールログを確認
- プロジェクト範囲外のシステムディレクトリにアクセスしていないことを確認


## ライセンス

GNU General Public License v3.0 - 詳細は [LICENSE](LICENSE) ファイルをご覧ください。

このプロジェクトはオープンソースであり、GPL v3 ライセンスの下で自由に使用、変更、配布できます。

## 謝辞

### 使用技術
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** - Anthropic の公式 CLI
- **[Cursor CLI](https://docs.cursor.com/en/cli/overview)** - Cursor の公式 CLI
- **[Codex](https://developers.openai.com/codex)** - OpenAI Codex
- **[React](https://react.dev/)** - ユーザーインターフェースライブラリ
- **[Vite](https://vitejs.dev/)** - 高速ビルドツールと開発サーバー
- **[Tailwind CSS](https://tailwindcss.com/)** - ユーティリティファースト CSS フレームワーク
- **[CodeMirror](https://codemirror.net/)** - 高度なコードエディター
- **[TaskMaster AI](https://github.com/eyaltoledano/claude-task-master)** *（オプション）* - AI 駆動のプロジェクト管理とタスク計画

## サポートとコミュニティ

### 最新情報を入手
- このリポジトリに **Star** をつけてサポートを表明
- **Watch** で更新や新リリースを確認
- プロジェクトを **Follow** してお知らせを受け取る

### スポンサー
- [Siteboon - AI powered website builder](https://siteboon.ai)
---

<div align="center">
  <strong>Claude Code、Cursor、Codex コミュニティのために心を込めて作りました。</strong>
</div>

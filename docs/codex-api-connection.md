# Codex API connections

Open **Settings → Agents → Codex → Account → Connect with an API key** to configure:

- **Provider ID**: a custom Codex provider identifier, such as `my-api`. Use the same ID as existing sessions to keep them visible in Codex's provider-filtered resume picker. The built-in `openai` ID is reserved.
- **Base URL**: the provider's Responses API base URL, such as `https://api.openai.com/v1`.
- **API Key**: the credential for that endpoint. A blank key preserves the saved credential when updating a connection.

Choose the model through the existing model picker or model library. The endpoint must support the Responses API. Saving a connection does not make a model request or validate the credential.

The authenticated settings API returns the provider ID, base URL and whether a key exists; it never returns the saved key. The key is stored as plaintext in the installation's server-side SQLite `app_config` table, so the database and its backups should be kept private. Removing the connection clears it and restores the existing Codex authentication behavior.

Chats use the official Codex SDK's per-process provider configuration and API key environment variable. No `auth.json` or user Codex configuration is changed, and Codex continues to own model requests and tool execution.

On Linux and macOS, newly created Codex terminals and plain web terminals use the same connection. A credential-free launcher under `~/.cloudcli/codex-shell/bin` forwards arguments to Codex; the API key is passed through the terminal process environment. Close and restart an existing terminal after saving, changing or removing a connection. A disconnected terminal that is reattached retains its original environment. External SSH and local terminals are unaffected. Windows terminal integration retains the existing behavior.

Session storage remains in the normal Codex home. To include sessions created by non-interactive web chats in the CLI resume picker, run:

```sh
codex resume --all --include-non-interactive
```

By default, the bundled Codex CLI is used. Operators can optionally set `CLOUDCLI_CODEX_PATH` to an executable path to use a separately maintained CLI for chats and configured web terminals; installed-version detection uses that same path.

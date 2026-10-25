# Workbench

Personal fork of [CloudCLI](https://github.com/siteboon/claudecodeui) (AGPL-3.0, license kept in `LICENSE`/`NOTICE`) that runs the official `claude` and `codex` CLIs in terminals, with a desktop shell. If you ever distribute it, you must publish the source.

Hard rules: no credential files are read, agents run only as the official CLIs in a PTY, the server listens on `127.0.0.1` only. See `ARCHITECTURE-NOTES.md`.

## Run in development

```bash
npm install
npm run dev:desktop      # Vite (hot reload) + Electron window; server on 127.0.0.1:3001
npm run desktop:workbench  # Electron against the built client (run `npm run build:client` first)
```

## Build

Windows (installer + portable exe, output in `release/workbench/`):

```bash
npm run build:desktop
```

macOS (dmg + zip, arm64). Must be built on the Mac:

```bash
xcode-select --install   # once, for native modules
npm install
npm run build:desktop:mac
```

The build rebuilds `better-sqlite3` for Electron, then restores it for your system Node (`npm rebuild better-sqlite3`). `node-pty` ships N-API prebuilds and is not rebuilt.

## First launch on macOS (unsigned app)

Right-click the app in `/Applications` and choose Open, or:

```bash
xattr -dr com.apple.quarantine /Applications/Workbench.app
```

## Requirements at runtime

`claude` and `codex` on your PATH, both logged in through their own login flows. On macOS the app reads your login-shell PATH at startup, so Finder/Dock launches find them. A missing CLI shows a message with install instructions and the app keeps running.

## Merging upstream

```bash
git fetch upstream
git merge upstream/main     # custom code lives in electron/workbench, server/workbench, src/workbench
```

Expect conflicts mainly in `server/modules/providers/*` (runtimes disabled), `server/index.ts` and `src/modules/project-workspace/*`. Re-run `npm run typecheck` and `npm test` after merging.

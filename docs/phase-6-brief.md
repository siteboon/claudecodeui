# Phase 6 — MCP integrations + auto-update verification

## Goal
Wire in two high-value MCP servers as recommended defaults. Verify the upstream auto-sync PR flow
works end-to-end by merging one real upstream release (if any pending).

## Repo location
Worktree `/Users/home/src/Dispatch-wt-6` on branch `feat/mcp-integrations`.

## MCPs to integrate

### DeusData/codebase-memory-mcp (1.7k★)
- Repo indexer with knowledge graph, 66 languages, ms-scale queries
- Adds repo-aware signals to sidebar: under each conversation, chip row showing "files touched"
- Auto-installed but toggleable in Settings
- `server/routes/mcp-bootstrap.js` — on first run, offers to enable (don't install without consent)
- Actually: since full-auto, **install it by default and tell user via morning text**; user can toggle off later

### steipete/claude-code-mcp (1.2k★)
- Claude Code as an MCP server — enables "spawn sub-agent" workflows
- Adds a "Spawn sub-agent" button to the chat composer (next to attach/mic icons)
- On click: modal with sub-agent type selector + optional prompt
- Calls the MCP; sub-agent runs in separate Claude Code session; streams output into the parent chat as a nested collapsible message

## Files to CREATE
- `server/routes/mcp-bootstrap.js` — ensures recommended MCPs are registered on boot
- `src/components/settings/RecommendedMCPs.tsx` — toggleable list in Settings
- `src/components/chat/SpawnSubAgentButton.tsx` — composer button + modal

## Files to TOUCH
- `server/index.js` — one require: `require('./routes/mcp-bootstrap').ensure();`
- Chat composer component — add `<SpawnSubAgentButton />` inside the existing button cluster

## Auto-update verification

1. Confirm `.github/workflows/sync-upstream.yml` exists (Phase 0 created it)
2. Manually dispatch the workflow: `gh workflow run sync-upstream.yml`
3. If upstream has new commits since our fork point: verify a draft PR opens from `upstream-sync → main`
4. Run CI on that PR
5. If clean: auto-merge (per repo settings) or close if nothing to sync

## Acceptance criteria
1. `codebase-memory-mcp` installed and registered; sidebar shows "files touched" chips under conversations
2. `claude-code-mcp` installed; composer has working "Spawn sub-agent" button that opens a modal; clicking the modal's submit button actually spawns an agent and streams output
3. Settings page lists both MCPs with toggles
4. Sync-upstream workflow either:
   - Successfully opens a PR with upstream's latest (if any new commits) → gets auto-merged if green → succeed
   - Returns "no new commits" → succeed
   - Fails → log + raise in morning summary

## Cost
Negligible. Both MCPs are self-hosted.

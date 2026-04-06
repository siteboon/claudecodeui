# LLM Unifier Backend Testing Report

Date: 2026-04-06

## Scope
This report validates the backend functionality checklist in `docs/backend/llm-unifier-helper.md`.

## Test Files Added
- `server/src/modules/llm/llm-unifier.providers.test.ts`
- `server/src/modules/llm/llm-unifier.sessions.test.ts`

Each test case includes an inline comment describing which helper requirement it covers.

## Command Used
```powershell
$env:TSX_TSCONFIG_PATH='server/tsconfig.json'; npm run test:server -- server/src/modules/llm/llm-unifier.providers.test.ts server/src/modules/llm/llm-unifier.sessions.test.ts
```

## Result
- Total tests: 32
- Passed: 32
- Failed: 0

## Requirement Coverage Matrix
| Helper requirement | Coverage |
| --- | --- |
| Session processing logic orchestration | `llmSessionsService.synchronizeSessions aggregates processed counts and failures`, `llmSessionsService.synchronizeProvider honors fullRescan option` |
| Start/resume behavior: Cursor | `cursor provider builds start/resume CLI invocations correctly` |
| Start/resume behavior: Gemini | `gemini provider builds start/resume CLI invocations and exposes curated models` |
| Start/resume/stop behavior: Codex (`startThread`, `resumeThread`, abort controller) | `codex provider start/resume use correct SDK thread methods and stop aborts signal` |
| Claude helper behavior (effort mapping, runtime permission handler, event normalization) | `claude provider helper mappings match unifier contract` |
| Model listing: Cursor (`--list-models` parsing) | `cursor provider parses model list output into normalized models` |
| Model listing: Gemini (curated options) | `gemini provider builds start/resume CLI invocations and exposes curated models` |
| Model listing: Codex (`~/.codex/models_cache.json`) | `codex provider reads models_cache.json and maps model metadata` |
| Runtime permission/thinking support constraints | `llmService rejects unsupported runtime permission and thinking mode combinations`, `providers enforce capability gates for model/thinking updates` |
| Thinking mode + model preference persistence across launches | `codex provider applies saved model/thinking preferences on subsequent launch` |
| Session history from DB `jsonl_path` (JSONL + Gemini JSON), no legacy fetcher path | `llmSessionsService.getSessionHistory parses JSONL and Gemini JSON correctly` |
| Session artifact deletion using processor path | `llmSessionsService.deleteSessionArtifacts validates ids and deletes disk/db artifacts` |
| Session rename/update path | `llmSessionsService.updateSessionCustomName validates existence before updating` |
| Conversation search over indexed transcript paths with provider/case filters | `conversationSearchService searches indexed transcripts with provider and case filters` |


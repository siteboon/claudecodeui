# LLM Unifier Helper-2 Backend Testing Report

Date: 2026-04-06

## Scope
This report validates every backend functionality listed in:
- `docs/backend/llm-unifier-helper-2.md`

All test cases include inline comments that describe which helper-2 requirement they cover.

## Test Files
- `server/src/modules/llm/llm-unifier.providers.test.ts`
- `server/src/modules/llm/llm-unifier.sessions.test.ts`
- `server/src/modules/llm/llm-unifier.images.test.ts`
- `server/src/modules/llm/llm-unifier.mcp.test.ts`
- `server/src/modules/llm/llm-unifier.skills.test.ts`

## package.json Scripts
- `test:server` now includes the full unifier suite.
- Added `test:server:llm-unifier-2` for running only helper-2 unifier coverage.

## Commands Used
```powershell
npm run typecheck:server
npm run test:server:llm-unifier-2
npm run test:server
```

## Results
- `typecheck:server`: pass
- `test:server:llm-unifier-2`: pass (`30/30`)
- `test:server`: pass (`30/30`)

## Requirement Coverage Matrix
| Helper-2 requirement | Test coverage |
| --- | --- |
| Universal image upload into `.cloudcli/assets` | `llmAssetsService stores uploaded images in .cloudcli/assets` |
| Image upload validation for supported image mime types | `llmAssetsService rejects unsupported image mime types` |
| Claude image prompt as content blocks with base64 images | `claude provider builds async prompt payload with base64 image blocks` |
| Codex image prompt via `local_image` entries | `codex provider sends local_image prompt items when image paths are provided` |
| Gemini/Cursor image handling by appending image path array to prompt | `gemini and cursor providers append image path arrays to prompts` |
| Start payload imagePaths validation | `llmService rejects invalid imagePaths payloads before provider execution` |
| MCP list grouped by User/Local/Project | `llmMcpService handles claude MCP scopes/transports with file-backed persistence` |
| MCP add/remove/update behavior backed by provider config files | `llmMcpService handles claude MCP scopes/transports with file-backed persistence`, `llmMcpService handles codex MCP TOML config and capability validation`, `llmMcpService handles gemini and cursor MCP JSON config formats` |
| Claude MCP transports: stdio/http/sse and scopes: user/local/project | `llmMcpService handles claude MCP scopes/transports with file-backed persistence` |
| Codex MCP transports: stdio/http and scopes: user/project | `llmMcpService handles codex MCP TOML config and capability validation` |
| Gemini MCP transports: stdio/http/sse and scopes: user/project | `llmMcpService handles gemini and cursor MCP JSON config formats` |
| Cursor MCP transports: stdio/http/sse and scopes: user/project | `llmMcpService handles gemini and cursor MCP JSON config formats` |
| Global MCP adder supports only `http` and `stdio` and applies to all providers | `llmMcpService global adder writes to all providers and rejects unsupported transports` |
| MCP run/connectivity checks (stdio and http) | `llmMcpService runProviderServer probes stdio and http MCP servers` |
| Claude skills fetch (user/project/plugin) and plugin namespacing | `llmSkillsService lists claude user/project/plugin skills with proper invocation names` |
| Codex skills fetch (repo/user/admin/system path model; tested repo/user/system paths) and `$` invocation | `llmSkillsService lists codex skills from repo/user/system locations with dollar invocation` |
| Gemini skills fetch from documented directories and `/` invocation | `llmSkillsService lists gemini skills from documented directories` |
| Cursor skills fetch from documented directories and `/` invocation | `llmSkillsService lists cursor skills from documented directories` |
| Existing unifier provider/session baseline behaviors remain passing | `llm-unifier.providers.test.ts`, `llm-unifier.sessions.test.ts` full suite |


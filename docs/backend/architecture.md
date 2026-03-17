# Backend Architecture

## Goal

This structure keeps the Day 1 runtime stable while giving the backend a clear home for shared HTTP concerns, shared types, OpenAPI work, and feature modules. The current runtime still lives in `server/index.js`, but everything new should be shaped around the layout below.

## Structure

```text
server/
  index.js
  start.js
  src/
    app.ts
    bootstrap.ts
    config/
      runtime.ts
    shared/
      http/
        api-response.ts
        async-handler.ts
        error-handler.ts
        not-found-handler.ts
        request-context.ts
      platform/
        runtime-platform.ts
        text.ts
        stream.ts
        shell.ts
        path.ts
      types/
        app.ts
        http.ts
      docs/
        openapi.ts
      utils/
        app-error.ts
        logger.ts
    modules/
      auth/
      cli-auth/
      user/
      settings/
      projects/
      files/
      sessions/
      git/
      taskmaster/
      agent/
      providers/
        claude/
        codex/
        cursor/
        gemini/
        mcp/
        plugins/
```

## File And Folder Roles

- `server/index.js`
  Temporary compatibility boundary for the old monolith. Day 1 keeps behavior here so the new TypeScript layout can grow around a stable runtime.
  Example: the existing websocket handlers, inline routes, and provider startup still live here until they are migrated module by module.

- `server/start.js`
  Thin production entrypoint for the compiled backend output.
  Example: `server:start` uses this file to verify `server/dist/bootstrap.js` exists and then loads it.

- `src/bootstrap.ts`
  Executable backend entrypoint used by `npm run server` and `npm run server:dev`.
  Example: `bootstrap.ts` should stay thin and do nothing except start the app, so later it remains safe to call in dev, prod, tests, or worker modes.

- `src/app.ts`
  Composition root for the backend application.
  Example: today it bridges into `index.js`; later it will create the Express app, apply shared middleware, register modules, attach websocket setup, and return the running application shape.

- `src/config/`
  Runtime configuration helpers and environment-aware path logic.
  Example: `config/runtime.ts` resolves the project root, server root, legacy runtime path, and built bootstrap path without scattering path math across the app.

- `src/shared/http/`
  Shared HTTP-level behavior that every module can reuse.
  Example: `api-response.ts` is where standard API response builders live.
  Example: `error-handler.ts` is where thrown `AppError` instances get translated into JSON payloads.
  Example: `request-context.ts` is where request IDs, timestamps, and per-request metadata are attached.
  Example: `async-handler.ts` removes repeated `try/catch(next)` wrappers in controllers.
  Example: `not-found-handler.ts` is the generic fallback for unknown API routes.

- `src/shared/platform/`
  Shared OS-adapter helpers for shell spawning, line ending normalization, streaming stdout/stderr parsing, and path normalization.
  Example: `platform/stream.ts` is where process output gets split into complete lines without leaking CRLF edge cases into feature code.
  Example: `platform/shell.ts` is where PowerShell-vs-bash command construction lives so provider modules do not branch on `process.platform`.

- `src/shared/types/`
  Global type aliases that are safe to share across modules. This layer uses `type`, not `interface`.
  Example: `types/http.ts` defines `ApiMeta`, `ApiErrorShape`, `RequestContext`, `AuthenticatedRequest`, and `EndpointInventoryRecord`.
  Example: `types/app.ts` defines `RuntimePaths`, `AppLocals`, and `ServerApplication`.

- `src/shared/docs/`
  Shared documentation helpers and future OpenAPI registry code.
  Example: `docs/openapi.ts` is the future home for global tags like `Auth`, `Projects`, `Files`, `Git`, and `Providers`, plus reusable schema registration.
- `src/shared/utils/`
  Shared non-HTTP utilities that stay generic and reusable.
  Example: `utils/app-error.ts` defines `AppError`, which feature modules can throw without knowing how HTTP serialization works.
  Example: `utils/logger.ts` is the centralized logger surface so modules do not ad-hoc `console.log` everywhere.

- `src/modules/`
  Feature boundaries. Every business area gets its own folder so request schemas, controllers, services, serializers, and docs stay close to the feature they belong to.

- `src/modules/auth/`
  Local authentication flows.
  Example: login, register, logout, and auth-status endpoints belong here.

- `src/modules/cli-auth/`
  CLI/provider authentication status flows for Claude, Cursor, Codex, and Gemini CLIs.
  Example: `/api/cli/claude/status` belongs here because it checks local CLI auth rather than app-user auth.

- `src/modules/user/`
  User-specific settings and onboarding state.
  Example: git identity setup and onboarding completion endpoints belong here.

- `src/modules/settings/`
  App-level stored secrets and toggles.
  Example: API keys and credential storage endpoints belong here because they configure backend access rather than user identity.

- `src/modules/projects/`
  Workspace and project registration concerns.
  Example: project listing, project creation, workspace creation, and project rename/delete flows belong here.

- `src/modules/files/`
  File tree and workspace file operations only.
  Example: read file, save file, upload file, create file, rename file, delete file, and image upload endpoints belong here.
  Example boundary rule: this module should not decide how projects are discovered; it only operates inside an already resolved project/workspace.

- `src/modules/sessions/`
  Conversation and provider session history concerns.
  Example: list sessions, fetch session messages, rename sessions, delete sessions, token-usage lookups, and conversation search belong here.

- `src/modules/git/`
  Repository operations and git intelligence.
  Example: status, diff, branch listing, checkout, commit, push, publish, discard, and AI commit-message generation endpoints belong here.

- `src/modules/taskmaster/`
  TaskMaster-specific project workflows.
  Example: detect installation, initialize TaskMaster, manage PRDs, add/update tasks, parse PRDs, and apply templates belong here.

- `src/modules/agent/`
  External agent execution API.
  Example: `/api/agent` belongs here because it orchestrates provider selection, cloning, project reuse, branch creation, streaming, and optional PR creation.

- `src/modules/providers/`
  Provider-specific integrations that are narrower than the general `agent` API.
  Example: provider session readers or provider-specific config endpoints should live here so Claude, Codex, Cursor, and Gemini logic do not bleed into unrelated modules.

- `src/modules/providers/claude/`
  Claude-specific runtime concerns.
  Example: if Claude gets module-specific schemas or adapters later, they belong here rather than inside generic session code.

- `src/modules/providers/codex/`
  Codex-specific config, session, and MCP-adjacent logic.
  Example: Codex MCP CLI endpoints and session history parsing can move here over time.

- `src/modules/providers/cursor/`
  Cursor-specific config, MCP, and stored session behavior.
  Example: Cursor config reads, MCP server mutation, and SQLite-backed session history belong here.

- `src/modules/providers/gemini/`
  Gemini-specific config and session behavior.
  Example: Gemini session message history and provider CLI lifecycle hooks belong here.

- `src/modules/providers/mcp/`
  MCP surfaces that are shared across providers or not owned by a single provider module.
  Example: generic Claude MCP CLI/config endpoints and helper endpoints belong here.

- `src/modules/providers/plugins/`
  Plugin runtime and plugin asset delivery.
  Example: plugin listing, installation, update, enable/disable, and asset serving can move here even though plugins are not an LLM provider; this keeps third-party integration surfaces grouped together.

## Boundary Rules

- `app.ts` wires modules together; it should not contain feature logic.
- `config/` resolves environment and filesystem context; it should not know HTTP payload details.
- `shared/http/` owns transport concerns; it should not know feature rules like how to rename a project.
- `shared/types/` only contains reusable type aliases; avoid feature-specific types here unless multiple modules truly share them.
- `modules/<feature>/` owns its own future `routes`, `controllers`, `services`, `schemas`, and `docs`.
- `projects`, `files`, and `sessions` stay separate on purpose:
  `projects` decides what a workspace/project is.
  `files` operates inside a resolved workspace.
  `sessions` manages chat/session history and search.
- `agent` stays separate from `providers`:
  `agent` is orchestration for external callers.
  `providers/*` are provider-specific adapters and APIs.

## Day 1 Notes

- The runtime still executes through `server/index.js` for safety.
- The new `src/` structure is now the required home for all new backend code.
- The generated inventory in `docs/backend/endpoint-inventory.*` is the source of truth for what must be migrated into these folders next.

## Package Scripts

These scripts live in `package.json`. The key distinction is:

- `server` and `server:dev` run the backend directly from TypeScript.
- `server:start` runs the compiled backend through `server/start.js`.
- `build` only builds the frontend.
- `server:build` only builds the backend.
- `start` runs the full production-style flow.

### Development Scripts

- `npm run dev`
  Starts the frontend and backend together.
  Use this for normal full-stack development when you want Vite and the API server running at the same time.
  Example: you are editing a React screen that calls `/api/projects` and also changing the backend route behavior.

- `npm run server:dev`
  Starts the backend in watch mode with `tsx watch --tsconfig server/tsconfig.json server/src/bootstrap.ts`.
  Use this for backend-only development.
  Example: you are refactoring request handling, logging, module structure, or shared HTTP utilities and want automatic restarts.

- `npm run server`
  Starts the backend once from TypeScript with `tsx --tsconfig server/tsconfig.json server/src/bootstrap.ts`.
  Use this when you want a stable one-shot backend process.
  Example: you want to reproduce a startup bug, inspect logs without reload noise, or test one backend flow manually.

- `npm run client`
  Starts only the Vite frontend dev server.
  Use this for frontend-only work when a backend is already running elsewhere.
  Example: you are polishing UI layout or fixing a component state bug and do not need to restart the API server.

### Build And Runtime Scripts

- `npm run build`
  Builds the frontend into `dist/`.
  Use this to verify production frontend bundling.
  Example: you changed React routing, code-splitting, or CSS and want to confirm the frontend still builds.

- `npm run server:build`
  Compiles the backend TypeScript using `server/tsconfig.json` into `server/dist/`.
  Use this to verify backend build correctness.
  Example: you changed `server/src/app.ts`, shared types, or future module imports and want to confirm compiled output is valid.

- `npm run server:start`
  Starts the built backend through `server/start.js`.
  Use this after `npm run server:build` when you want to run compiled backend output only.
  Example: dev mode works, but you want to make sure the production entrypoint and compiled files also work correctly.

- `npm run start`
  Runs `npm run build`, then `npm run server:build`, then `npm run server:start`.
  Use this as the closest local equivalent to a production run.
  Example: before shipping, you want to confirm the built frontend and built backend work together, not just the watch-mode setup.

- `npm run preview`
  Serves the built frontend bundle with Vite preview.
  Use this when you want to inspect the built frontend output specifically.
  Example: you want to check whether a client-side issue only appears in production assets.
  Note: this does not replace the backend server. API routes still require the backend to be running separately.

### Validation Scripts

- `npm run typecheck:client`
  Runs TypeScript checking for the frontend only.
  Use this after frontend code changes.
  Example: you changed hook types, component props, or frontend shared models.

- `npm run typecheck:server`
  Runs TypeScript checking for the backend only.
  Use this after backend code changes.
  Example: you changed shared HTTP helpers, backend imports, or module boundaries.

- `npm run typecheck`
  Runs both frontend and backend typechecks.
  Use this as the default correctness check before commit or PR.
  Example: you changed `src/` and `server/src/` in the same branch and want one command to validate both.

- `npm run lint`
  Runs ESLint on `src/` only.
  Use this for frontend lint validation.
  Example: you changed React files and want to catch unused imports, hook issues, or style violations.

- `npm run lint:fix`
  Runs ESLint on `src/` and auto-fixes what it can.
  Use this after frontend edits when you want quick cleanup.
  Example: you renamed components and want ESLint to remove stale imports and apply automatic fixes.

### Release And Lifecycle Scripts

- `npm run release`
  Runs `release.sh`, which loads `GITHUB_TOKEN` from `.env` and then executes `release-it`.
  Use this only when intentionally creating a release.
  Example: you are cutting a new tagged version and want versioning/changelog automation.

- `prepublishOnly`
  Runs automatically before `npm publish`.
  It builds both frontend and backend first.
  Example: this prevents publishing a broken package that was never built.

- `postinstall`
  Runs automatically after `npm install`.
  It executes `scripts/fix-node-pty.js`.
  Example: this helps keep native terminal integration working after dependency installation.

- `prepare`
  Runs automatically during install in development contexts.
  It sets up Husky hooks.
  Example: this ensures local git hooks are installed without requiring a separate setup command.

### Recommended Workflows

- Full-stack local development:
  `npm install` then `npm run dev`

- Backend-only refactor work:
  `npm run server:dev` then `npm run typecheck:server`

- Frontend-only work:
  `npm run client`, `npm run typecheck:client`, and `npm run lint`

- Pre-PR validation:
  `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run server:build`

- Production-style local verification:
  `npm run start`

- Release preparation:
  `npm run typecheck`, `npm run build`, `npm run server:build`, and `npm run release`

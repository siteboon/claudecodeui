# Backend Architecture

## Goal

This document defines the target backend shape for the TypeScript refactor in `server/src`.

The main constraints are:

- Keep the current API paths stable while the internals move out of `server/index.js` and `server/routes/*.js`.
- Migrate one route family at a time instead of doing a big-bang rewrite.
- Keep controllers thin and move business logic into services and repositories.
- Keep transport concerns, provider adapters, and domain logic separate.

## Current State

As of March 18, 2026:

- `server/src/bootstrap.ts` starts the TypeScript backend entrypoint.
- `server/src/app.ts` still bridges into `server/src/runner.ts`.
- `server/src/shared/*` already contains reusable TypeScript building blocks such as:
  - `shared/http/api-response.ts`
  - `shared/http/async-handler.ts`
  - `shared/http/error-handler.ts`
  - `shared/http/request-context.ts`
  - `shared/utils/app-error.ts`
  - `shared/database/repositories/*`
- `server/src/modules/*` mostly exist as placeholder folders.
- The real runtime behavior still mostly lives in:
  - `server/index.js`
  - `server/routes/*.js`
- `docs/backend/endpoint-inventory.md` is the migration checklist for the existing HTTP surface.

## Recommended Target Structure

```text
server/
  index.js                      # legacy runtime bridge during migration
  start.js                      # production entrypoint for compiled output
  src/
    bootstrap.ts                # starts the backend process
    app.ts                      # creates the app/server and registers modules
    runner.ts                   # transitional runtime while legacy code still exists
    config/
      load-env-vars.ts
      runtime.ts
    realtime/
      index.ts                  # attaches websocket handlers to the HTTP server
      chat.gateway.ts           # chat websocket behavior
      shell.gateway.ts          # shell websocket behavior
      events.ts                 # shared broadcast helpers
    shared/
      auth/
        authenticate-token.ts   # future TS auth middleware
        validate-api-key.ts     # future TS API-key middleware
      database/
        connection.ts
        init-db.ts
        migrations.ts
        schema.ts
        types.ts
        repositories/
          api-keys.ts
          app-config.ts
          credentials.ts
          session-names.ts
          users.ts
      docs/
        openapi.ts
      http/
        api-response.ts
        async-handler.ts
        error-handler.ts
        not-found-handler.ts
        request-context.ts
      input/
        parse-boolean.ts        # future shared query/body parsers
        parse-pagination.ts
      platform/
        index.ts
        path.ts
        runtime-platform.ts
        shell.ts
        stream.ts
        text.ts
        types.ts
      types/
        app.ts
        http.ts
      utils/
        app-error.ts
        logger.ts
    modules/
      auth/
        index.ts
        auth.routes.ts
        auth.controller.ts
        auth.service.ts
        auth.schemas.ts
        auth.types.ts
      cli-auth/
        index.ts
        cli-auth.routes.ts
        cli-auth.controller.ts
        cli-auth.service.ts
      user/
        index.ts
        user.routes.ts
        user.controller.ts
        user.service.ts
        user.schemas.ts
        user.types.ts
      settings/
        index.ts
        settings.routes.ts
        settings.controller.ts
        settings.service.ts
        settings.schemas.ts
      commands/
        index.ts
        commands.routes.ts
        commands.controller.ts
        commands.service.ts
      projects/
        index.ts
        projects.routes.ts
        projects.controller.ts
        projects.service.ts
        projects.schemas.ts
        workspace-path.policy.ts
      files/
        index.ts
        files.routes.ts
        files.controller.ts
        files.service.ts
        files.schemas.ts
      sessions/
        index.ts
        sessions.routes.ts
        sessions.controller.ts
        sessions.service.ts
        sessions.schemas.ts
      git/
        index.ts
        git.routes.ts
        git.controller.ts
        git.service.ts
      taskmaster/
        index.ts
        taskmaster.routes.ts
        taskmaster.controller.ts
        taskmaster.service.ts
      agent/
        index.ts
        agent.routes.ts
        agent.controller.ts
        agent.service.ts
      system/
        index.ts
        system.routes.ts
        system.controller.ts
        system.service.ts
        spa-fallback.ts
      providers/
        claude/
          index.ts
          claude.service.ts
          claude-session.service.ts
        codex/
          index.ts
          codex.routes.ts
          codex.controller.ts
          codex.service.ts
        cursor/
          index.ts
          cursor.routes.ts
          cursor.controller.ts
          cursor.service.ts
        gemini/
          index.ts
          gemini.routes.ts
          gemini.controller.ts
          gemini.service.ts
        mcp/
          index.ts
          mcp.routes.ts
          mcp.controller.ts
          mcp.service.ts
        plugins/
          index.ts
          plugins.routes.ts
          plugins.controller.ts
          plugins.service.ts
    testing/
      fixtures/
```

## Why This Shape Works For This Repo

- You already have shared TypeScript HTTP/database utilities in `server/src/shared`.
- The legacy route surface is already grouped by domain in `server/routes/*.js`.
- The biggest remaining problem is not "what framework should I use", it is "where should each existing endpoint live and how do I migrate it without breaking paths".
- A module-per-domain structure solves that without forcing a rewrite of all helpers at once.

## Route Ownership

Keep the public paths stable. Only move the code behind them.

| Module | Mount path(s) | Current source(s) | Notes |
| --- | --- | --- | --- |
| `auth` | `/api/auth` | `server/routes/auth.js` | Login, register, logout, auth status, current user |
| `cli-auth` | `/api/cli` | `server/routes/cli-auth.js` | Provider CLI auth status endpoints |
| `user` | `/api/user` | `server/routes/user.js` | Git identity and onboarding state |
| `settings` | `/api/settings` | `server/routes/settings.js` | API keys, credentials, notification preferences, push setup |
| `commands` | `/api/commands` | `server/routes/commands.js` | Slash command list, load, execute |
| `projects` | `/api/projects`, `/api/browse-filesystem`, `/api/create-folder` | `server/routes/projects.js`, `server/index.js` | Workspace discovery and workspace creation helpers |
| `files` | `/api/projects/:projectName/file`, `/api/projects/:projectName/files` | `server/index.js` | File tree, read/write, upload, rename, delete |
| `sessions` | `/api/projects/:projectName/sessions`, `/api/sessions/:sessionId/rename`, `/api/search/conversations` | `server/index.js`, provider route files | Project/provider session history |
| `git` | `/api/git` | `server/routes/git.js` | Repo operations and git automation |
| `taskmaster` | `/api/taskmaster` | `server/routes/taskmaster.js` | TaskMaster setup, PRDs, tasks, parsing |
| `agent` | `/api/agent` | `server/routes/agent.js` | External agent orchestration |
| `system` | `/health`, `/api/system`, `/api/transcribe`, SPA fallback | `server/index.js` | Health, app update, transcription, non-API fallback. Register the SPA fallback last. |
| `providers/codex` | `/api/codex` | `server/routes/codex.js` | Config, MCP-adjacent behavior, Codex sessions |
| `providers/cursor` | `/api/cursor` | `server/routes/cursor.js` | Config, MCP, Cursor sessions |
| `providers/gemini` | `/api/gemini` | `server/routes/gemini.js` | Gemini session endpoints |
| `providers/mcp` | `/api/mcp`, `/api/mcp-utils` | `server/routes/mcp.js`, `server/routes/mcp-utils.js` | Shared MCP HTTP endpoints |
| `providers/plugins` | `/api/plugins` | `server/routes/plugins.js` | Plugin install, enable/disable, assets |
| `providers/claude` | no standalone HTTP prefix yet | `server/index.js`, `server/claude-sdk.js` | Service/adapters used by chat and agent flows |
| `realtime` | `/ws`, `/shell` | `server/index.js` | Websocket transport, not HTTP routes |

## Module Convention

Every feature module should follow the same internal shape:

```text
modules/user/
  index.ts            # registers the module on the app
  user.routes.ts      # express.Router + middleware order
  user.controller.ts  # request/response mapping only
  user.service.ts     # business rules and orchestration
  user.schemas.ts     # input parsing and validation
  user.types.ts       # module-local types only
```

### Responsibilities

- `index.ts`
  Owns the mount path.
  `app.ts` should not know route internals.

- `*.routes.ts`
  Declares routes, middleware order, and child-router mounting.
  It should not contain SQL, filesystem logic, or long validation blocks.

- `*.controller.ts`
  Reads `req`, calls schema parsers and services, then writes the response.
  It should stay thin.

- `*.service.ts`
  Owns business logic.
  It can call repositories, filesystem helpers, platform helpers, provider adapters, and child processes.

- `*.schemas.ts`
  Validates/parses request data close to the module.
  Throw `AppError` with `400` status for bad input.

- `*.types.ts`
  Holds module-local types that do not belong in `shared/types`.

## Application Setup

The current `server/src/app.ts` still starts a transitional runner.
Once the HTTP runtime moves into `server/src`, the shape should look like this:

```ts
import cors from 'cors';
import express from 'express';
import http from 'http';

import { registerAgentModule } from '@/modules/agent/index.js';
import { registerAuthModule } from '@/modules/auth/index.js';
import { registerCliAuthModule } from '@/modules/cli-auth/index.js';
import { registerCommandsModule } from '@/modules/commands/index.js';
import { registerFilesModule } from '@/modules/files/index.js';
import { registerGitModule } from '@/modules/git/index.js';
import { registerProjectsModule } from '@/modules/projects/index.js';
import { registerSessionsModule } from '@/modules/sessions/index.js';
import { registerSettingsModule } from '@/modules/settings/index.js';
import { registerSystemModule } from '@/modules/system/index.js';
import { registerTaskmasterModule } from '@/modules/taskmaster/index.js';
import { registerUserModule } from '@/modules/user/index.js';
import { registerCodexProviderModule } from '@/modules/providers/codex/index.js';
import { registerCursorProviderModule } from '@/modules/providers/cursor/index.js';
import { registerGeminiProviderModule } from '@/modules/providers/gemini/index.js';
import { registerMcpProviderModule } from '@/modules/providers/mcp/index.js';
import { registerPluginsProviderModule } from '@/modules/providers/plugins/index.js';
import { registerSpaFallback } from '@/modules/system/spa-fallback.js';
import { errorHandler } from '@/shared/http/error-handler.js';
import { notFoundHandler } from '@/shared/http/not-found-handler.js';
import { requestContextMiddleware } from '@/shared/http/request-context.js';
import { attachRealtimeHandlers } from '@/realtime/index.js';

export function createHttpRuntime() {
  const app = express();
  const server = http.createServer(app);

  // Global middleware should be registered once, before feature modules.
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(requestContextMiddleware);

  // Keep health/system API routes early so diagnostics still work
  // even if a later feature module throws during registration.
  registerSystemModule(app);

  // Public/auth routes first.
  registerAuthModule(app);

  // Authenticated feature modules after auth.
  registerCliAuthModule(app);
  registerUserModule(app);
  registerSettingsModule(app);
  registerCommandsModule(app);
  registerProjectsModule(app);
  registerFilesModule(app);
  registerSessionsModule(app);
  registerGitModule(app);
  registerTaskmasterModule(app);
  registerAgentModule(app);
  registerCodexProviderModule(app);
  registerCursorProviderModule(app);
  registerGeminiProviderModule(app);
  registerMcpProviderModule(app);
  registerPluginsProviderModule(app);

  // Websocket setup should live outside HTTP controllers.
  attachRealtimeHandlers(server, app);

  // The React fallback must be last or it will swallow real API routes.
  registerSpaFallback(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app, server };
}
```

## Example Module: `user`

This is a good first migration candidate because the endpoints are small, the domain is clear, and you already have a typed user repository in `server/src/shared/database/repositories/users.ts`.

### Folder

```text
server/src/modules/user/
  index.ts
  user.routes.ts
  user.controller.ts
  user.service.ts
  user.schemas.ts
  user.types.ts
```

### `index.ts`

```ts
import type { Express } from 'express';

import { createUserRouter } from './user.routes.js';

export function registerUserModule(app: Express): void {
  // Keep the mount path in one place.
  // This makes it easy to see who owns `/api/user`.
  app.use('/api/user', createUserRouter());
}
```

### `user.routes.ts`

```ts
import { Router } from 'express';

import { asyncHandler } from '@/shared/http/async-handler.js';
// Day 1: reuse the existing JS middleware while auth is still being migrated.
import { authenticateToken } from '../../../middleware/auth.js';

import {
  completeOnboardingController,
  getGitConfigController,
  getOnboardingStatusController,
  updateGitConfigController,
} from './user.controller.js';

export function createUserRouter(): Router {
  const router = Router();

  // Routes only describe the HTTP surface and middleware order.
  router.get('/git-config', authenticateToken, asyncHandler(getGitConfigController));
  router.post('/git-config', authenticateToken, asyncHandler(updateGitConfigController));
  router.get('/onboarding-status', authenticateToken, asyncHandler(getOnboardingStatusController));
  router.post('/complete-onboarding', authenticateToken, asyncHandler(completeOnboardingController));

  return router;
}
```

### `user.schemas.ts`

```ts
import { AppError } from '@/shared/utils/app-error.js';

export type UpdateGitConfigInput = {
  gitName: string;
  gitEmail: string;
};

export function parseUpdateGitConfigInput(body: unknown): UpdateGitConfigInput {
  const value = body as Partial<UpdateGitConfigInput> | null;

  // Keep input validation close to the module so controllers stay thin.
  if (!value?.gitName || !value?.gitEmail) {
    throw new AppError('Git name and email are required', {
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
  }

  const gitName = value.gitName.trim();
  const gitEmail = value.gitEmail.trim();

  if (!gitName) {
    throw new AppError('Git name is required', {
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
  }

  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(gitEmail)) {
    throw new AppError('Invalid email format', {
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
  }

  return {
    gitName,
    gitEmail,
  };
}
```

### `user.service.ts`

```ts
import { userDb } from '@/shared/database/repositories/users.js';
import { AppError } from '@/shared/utils/app-error.js';

import type { UpdateGitConfigInput } from './user.schemas.js';

export const userService = {
  getGitConfig(userId: number) {
    const gitConfig = userDb.getGitConfig(userId);

    return {
      gitName: gitConfig?.git_name ?? null,
      gitEmail: gitConfig?.git_email ?? null,
    };
  },

  updateGitConfig(userId: number, input: UpdateGitConfigInput) {
    if (!userDb.getUserById(userId)) {
      throw new AppError('User not found', {
        code: 'USER_NOT_FOUND',
        statusCode: 404,
      });
    }

    // Services own business rules and side effects.
    // If you later re-add `git config --global`, it belongs here.
    userDb.updateGitConfig(userId, input.gitName, input.gitEmail);

    return {
      gitName: input.gitName,
      gitEmail: input.gitEmail,
    };
  },

  getOnboardingStatus(userId: number) {
    return {
      hasCompletedOnboarding: userDb.hasCompletedOnboarding(userId),
    };
  },

  completeOnboarding(userId: number) {
    userDb.completeOnboarding(userId);

    return {
      message: 'Onboarding completed successfully',
    };
  },
};
```

### `user.controller.ts`

```ts
import type { Response } from 'express';

import {
  createApiMeta,
  createApiSuccessResponse,
} from '@/shared/http/api-response.js';
import { getRequestContext } from '@/shared/http/request-context.js';
import type { AuthenticatedRequest } from '@/shared/types/http.js';
import { AppError } from '@/shared/utils/app-error.js';

import { parseUpdateGitConfigInput } from './user.schemas.js';
import { userService } from './user.service.js';

function getUserId(req: AuthenticatedRequest): number {
  const userId = Number(req.user?.id);

  if (!Number.isFinite(userId)) {
    throw new AppError('Authenticated user is missing', {
      code: 'UNAUTHENTICATED',
      statusCode: 401,
    });
  }

  return userId;
}

function getMeta(req: AuthenticatedRequest) {
  const context = getRequestContext(req);
  return createApiMeta(context?.requestId, context?.startedAt);
}

export async function getGitConfigController(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const data = userService.getGitConfig(getUserId(req));
  res.json(createApiSuccessResponse(data, getMeta(req)));
}

export async function updateGitConfigController(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const input = parseUpdateGitConfigInput(req.body);
  const data = userService.updateGitConfig(getUserId(req), input);
  res.json(createApiSuccessResponse(data, getMeta(req)));
}

export async function getOnboardingStatusController(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const data = userService.getOnboardingStatus(getUserId(req));
  res.json(createApiSuccessResponse(data, getMeta(req)));
}

export async function completeOnboardingController(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  const data = userService.completeOnboarding(getUserId(req));
  res.json(createApiSuccessResponse(data, getMeta(req)));
}
```

## Nested Route Example: `files`

`files` is the best example of why route ownership and mount paths matter.
The files module should stay separate from `projects`, but its routes still need access to `:projectName`.

### `files/index.ts`

```ts
import type { Express } from 'express';

import { createFilesRouter } from './files.routes.js';

export function registerFilesModule(app: Express): void {
  // The files module owns project-scoped file operations.
  app.use('/api/projects/:projectName', createFilesRouter());
}
```

### `files.routes.ts`

```ts
import { Router } from 'express';

import { asyncHandler } from '@/shared/http/async-handler.js';
import { authenticateToken } from '../../../middleware/auth.js';

import {
  deleteFilesController,
  getFileController,
  getFilesController,
  putFileController,
} from './files.controller.js';

export function createFilesRouter(): Router {
  // `mergeParams: true` lets this router read `req.params.projectName`
  // from the mount path declared in `index.ts`.
  const router = Router({ mergeParams: true });

  router.get('/file', authenticateToken, asyncHandler(getFileController));
  router.put('/file', authenticateToken, asyncHandler(putFileController));
  router.get('/files', authenticateToken, asyncHandler(getFilesController));
  router.delete('/files', authenticateToken, asyncHandler(deleteFilesController));

  return router;
}
```

### Why This Separation Is Useful

- `projects` decides what a project/workspace is.
- `files` only operates inside a resolved project.
- `sessions` only deals with chat/session history.
- This prevents one giant `projects.service.ts` from becoming the new monolith.

## Provider Module Pattern

Provider modules should follow the same structure, but they usually own adapter logic as well as HTTP routes.

Example shape for `providers/codex`:

```text
modules/providers/codex/
  index.ts
  codex.routes.ts
  codex.controller.ts
  codex.service.ts
  codex.types.ts
  codex-mcp.service.ts
  codex-sessions.service.ts
```

Use this rule:

- If the code is specific to one provider, keep it inside that provider folder.
- If the code is shared across multiple providers, move it into `shared/` or `providers/mcp/`.
- If the code is an external-facing orchestration endpoint that can call different providers, keep it in `modules/agent/`.

## Realtime Structure

Do not leave websocket logic inside `app.ts` or feature controllers.

Use a dedicated `server/src/realtime/` area:

```text
server/src/realtime/
  index.ts
  chat.gateway.ts
  shell.gateway.ts
  events.ts
```

Suggested responsibilities:

- `index.ts`
  Attaches websocket handlers to the HTTP server.

- `chat.gateway.ts`
  Owns `/ws` message handling, provider session streaming, reconnect behavior, and approval flows.

- `shell.gateway.ts`
  Owns `/shell` PTY session lifecycle, resize events, and output streaming.

- `events.ts`
  Owns broadcast helpers used by HTTP modules such as TaskMaster or project updates.

## Boundary Rules

- `app.ts` wires modules together. It should not contain feature logic.
- `bootstrap.ts` starts the process. It should not know route details.
- `routes` files should not contain SQL, filesystem logic, provider process spawning, or long validation blocks.
- `controllers` should not import `better-sqlite3`, `fs`, `node-pty`, or raw provider SDKs.
- `services` own business rules, orchestration, and side effects.
- `repositories` own SQL only.
- `shared/*` is only for code used by two or more modules.
- `providers/*` is for provider-specific behavior.
- `agent` is orchestration above provider modules.
- `realtime/*` owns websocket transport, not HTTP modules.
- `system` owns health/update/fallback endpoints, not project/file/session behavior.

## Migration Order

This order keeps risk low:

1. `auth`, `cli-auth`, `user`
   Small route files, easy to validate, minimal path behavior.

2. `settings`, `commands`
   Still mostly isolated and already grouped in dedicated route files.

3. `projects`, `files`, `sessions`
   These are more coupled and require clear boundaries around `projectName`.

4. `git`, `taskmaster`
   Heavier side effects and more external process behavior.

5. `providers/*`
   Each provider can move independently once shared platform helpers are stable.

6. `agent`
   Migrate last because it orchestrates several other pieces.

7. `realtime/*`
   Move websocket logic after the supporting services are already modular.

## Day 1 Migration Rules

- Keep path compatibility first.
- Move one route family at a time.
- It is acceptable to import legacy JS middleware or helpers from a new TS module temporarily.
- When a route family is migrated:
  - register the new TS module in `app.ts`
  - remove the old route registration from `server/index.js`
  - keep the response shape unchanged unless you intentionally version it
- Prefer moving business logic into services first, then move transport code.

## Practical Setup Checklist

When you create a new module, use this checklist:

1. Add the folder under `server/src/modules/<feature>/`.
2. Create `index.ts`, `*.routes.ts`, `*.controller.ts`, `*.service.ts`, and `*.schemas.ts`.
3. Keep the mount path inside `index.ts`.
4. Reuse `asyncHandler`, `AppError`, `createApiSuccessResponse`, and `requestContextMiddleware`.
5. Reuse typed repositories from `server/src/shared/database/repositories/*` whenever possible.
6. Register the module in `server/src/app.ts`.
7. Move one legacy route at a time and verify the response shape still matches the frontend.

## Package Script Notes

These scripts already match the refactor workflow:

- `npm run server:dev`
  Use for backend-only refactor work in `server/src`.

- `npm run typecheck:server`
  Run after every backend module migration.

- `npm run test:server`
  Use for shared platform tests and expand it as new TS modules gain tests.

- `npm run server:build`
  Confirms the refactored backend compiles into `server/dist`.

- `npm run verify:server`
  Best validation command before merging backend refactor work.

## Summary

The simplest stable rule set for this refactor is:

- keep API paths the same
- move code into domain modules
- keep routes thin
- keep business logic in services
- keep SQL in repositories
- keep provider code inside provider folders
- keep websocket code outside HTTP modules

If you follow that consistently, `server/src` will become the real backend instead of a second monolith with TypeScript syntax.

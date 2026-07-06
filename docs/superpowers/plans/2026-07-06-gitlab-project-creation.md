# GitLab Project Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create Project supports GitHub and GitLab repositories, including self-hosted GitLab, with the right stored GitLab token selected by repository host.

**Architecture:** Keep the existing EventSource clone flow and `git clone` implementation. Extend the generic credentials table with `credential_host`, use generic credential lookup in the clone service, and keep legacy GitHub query params working. The frontend reuses the existing GitHub token UI shape for provider-specific token lists.

**Tech Stack:** TypeScript, React, Express, SQLite via better-sqlite3, Node `node:test`.

## Global Constraints

- Keep one clone workflow backed by `git clone`.
- Separate credentials by type: `github_token` for GitHub and `gitlab_token` for GitLab.
- GitLab credentials store a host such as `gitlab.com` or `git.company.com`.
- Create Project preselects the active GitLab token whose host matches the repository URL host.
- Unknown HTTPS URLs allow a one-off token but do not show stored provider tokens.
- Continue accepting legacy `githubUrl`, `githubTokenId`, and `newGithubToken` query params.
- No GitLab API integration.

---

## File Structure

- Modify `server/modules/database/schema.ts`: add nullable `credential_host`.
- Modify `server/modules/database/migrations.ts`: add migration for existing DBs.
- Modify `server/modules/database/repositories/credentials.ts`: create/list/fetch credentials with optional host.
- Modify `server/routes/settings.js`: accept `credentialHost`.
- Modify `server/modules/projects/services/project-clone.service.ts`: provider-neutral clone input and generic credential lookup.
- Modify `server/modules/projects/projects.routes.ts`: read both new and legacy clone query params.
- Modify `server/modules/projects/tests/project-clone.service.test.ts`: cover GitLab/generic token paths and legacy GitHub params.
- Modify `src/components/project-creation-wizard/*`: provider detection, token loading, token preselection, neutral request params.
- Modify `src/components/settings/*`: add GitLab credential state and section.
- Modify `src/i18n/locales/en/common.json` and `src/i18n/locales/en/settings.json`: English labels for the changed UI.

## Task 1: Backend Credentials And Clone Params

**Files:**
- Modify: `server/modules/database/schema.ts`
- Modify: `server/modules/database/migrations.ts`
- Modify: `server/modules/database/repositories/credentials.ts`
- Modify: `server/routes/settings.js`
- Modify: `server/modules/projects/services/project-clone.service.ts`
- Modify: `server/modules/projects/projects.routes.ts`
- Test: `server/modules/projects/tests/project-clone.service.test.ts`

**Interfaces:**
- Produces: `credentialsDb.getCredentialValueById(userId, credentialId, credentialType): string | null`
- Produces: `startCloneProject({ workspacePath, repositoryUrl, credentialType, credentialId, newCredentialToken, userId })`
- Preserves: legacy `githubUrl`, `githubTokenId`, `newGithubToken`

- [ ] **Step 1: Write failing clone service tests**

Add tests asserting:

```ts
test('startCloneProject injects selected gitlab token into https clone URL', async () => {
  const gitProcess = createMockGitProcess();
  let capturedCloneUrl = '';

  const operation = await startCloneProject(
    {
      workspacePath: '/workspace/root',
      repositoryUrl: 'https://git.company.com/team/repo.git',
      credentialType: 'gitlab_token',
      credentialId: 42,
      userId: 1,
    },
    { onProgress: () => undefined, onComplete: () => undefined },
    buildDependencies({
      getCredentialValueById: async (_userId, credentialId, credentialType) => {
        assert.equal(credentialId, 42);
        assert.equal(credentialType, 'gitlab_token');
        return 'gitlab-secret';
      },
      spawnGitClone: (cloneUrl) => {
        capturedCloneUrl = cloneUrl;
        return gitProcess as any;
      },
    }),
  );

  gitProcess.emit('close', 0);
  await operation.waitForCompletion;

  assert.equal(capturedCloneUrl, 'https://gitlab-secret@git.company.com/team/repo.git');
});
```

- [ ] **Step 2: Run focused test and confirm failure**

Run: `npm exec -- tsx --tsconfig server/tsconfig.json --test server/modules/projects/tests/project-clone.service.test.ts`

Expected: FAIL because provider-neutral fields/dependency do not exist.

- [ ] **Step 3: Implement backend minimum**

Add `credential_host TEXT` to schema and migration, extend credential create/list queries, add generic credential value lookup, parse `repositoryUrl`/`credentialId`/`credentialType` in the route with legacy fallback, and rename clone internals from GitHub-specific to repository/credential naming while preserving legacy inputs.

- [ ] **Step 4: Run focused test**

Run: `npm exec -- tsx --tsconfig server/tsconfig.json --test server/modules/projects/tests/project-clone.service.test.ts`

Expected: PASS.

## Task 2: Create Project Provider Detection

**Files:**
- Modify: `src/components/project-creation-wizard/types.ts`
- Modify: `src/components/project-creation-wizard/utils/pathUtils.ts`
- Modify: `src/components/project-creation-wizard/data/workspaceApi.ts`
- Modify: `src/components/project-creation-wizard/hooks/useGithubTokens.ts`
- Modify: `src/components/project-creation-wizard/ProjectCreationWizard.tsx`
- Modify: `src/components/project-creation-wizard/components/StepConfiguration.tsx`
- Modify: `src/components/project-creation-wizard/components/GithubAuthenticationCard.tsx`
- Modify: `src/components/project-creation-wizard/components/StepReview.tsx`
- Modify: `src/i18n/locales/en/common.json`

**Interfaces:**
- Consumes: active credentials include optional `credential_host`.
- Produces: `getRepositoryHost(url): string | null`
- Produces: `getRepositoryProvider(url, gitlabHosts): 'github' | 'gitlab' | 'unknown' | 'ssh' | null`

- [ ] **Step 1: Add one small util test**

Create a minimal test file for path utils or add an assert self-check if the project has no frontend test runner configured. Cover GitHub, `gitlab.com`, self-hosted host match, SSH, and unknown HTTPS.

- [ ] **Step 2: Run the util test and confirm failure**

Run the smallest available command. If no frontend test command exists, run `npm run typecheck` after adding the self-check target.

- [ ] **Step 3: Implement wizard changes**

Load GitHub and GitLab credentials, derive provider from URL plus stored GitLab hosts, show provider-specific token labels, preselect the matching GitLab host token, and send provider-neutral clone params:

```ts
repositoryUrl
credentialType
credentialId
newCredentialToken
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

## Task 3: GitLab Credentials Settings UI

**Files:**
- Modify: `src/components/settings/view/tabs/api-settings/types.ts`
- Modify: `src/components/settings/hooks/useCredentialsSettings.ts`
- Modify: `src/components/settings/view/tabs/api-settings/CredentialsSettingsTab.tsx`
- Create or modify: `src/components/settings/view/tabs/api-settings/sections/GitlabCredentialsSection.tsx`
- Modify: `src/i18n/locales/en/settings.json`

**Interfaces:**
- Consumes: `/api/settings/credentials?type=gitlab_token`
- Produces: `credentialHost` in create credential payload.

- [ ] **Step 1: Implement by copying the existing GitHub settings pattern**

Add GitLab form fields for name, host, token, optional description. Reuse the generic credentials endpoint with:

```json
{
  "credentialType": "gitlab_token",
  "credentialHost": "git.company.com"
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

## Task 4: Final Verification And Commit

**Files:**
- All files changed by Tasks 1-3.

- [ ] **Step 1: Run focused backend tests**

Run: `npm exec -- tsx --tsconfig server/tsconfig.json --test server/modules/projects/tests/project-clone.service.test.ts`

Expected: PASS.

- [ ] **Step 2: Run full typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 3: Run review**

Use `/review` against the pre-implementation base commit.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-07-06-gitlab-project-creation.md server src
git commit -m "feat: support gitlab project creation"
```

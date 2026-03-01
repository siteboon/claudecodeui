# Task 4: Slash Commands & Skills Support — Design Doc

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port all slash command enhancements from `feature/personal-enhancements` to a single focused PR for upstream.

**Branch:** `feat/slash-commands-skills` (from `main`)

**Approach:** Single comprehensive PR. Manual porting (no cherry-pick).

---

## What Upstream Already Has

Upstream main has a complete slash command system (built across PRs #211, #392, #374, #402):

- `server/routes/commands.js` (601 lines) — command discovery from `.claude/commands/`, 8 built-in commands, 3 API endpoints
- `src/components/chat/hooks/useSlashCommands.ts` (375 lines) — detection, fuzzy search, keyboard nav, `onExecuteCommand` callback
- `src/components/chat/view/subcomponents/CommandMenu.tsx` (224 lines) — dropdown UI
- `useChatComposerState.ts` — wired with `executeCommand`, single-command interception on submit

## What This PR Adds (3 Enhancements)

### Enhancement 1: Skill Discovery & Loading (~200 lines)

**Files:**
- `server/routes/commands.js` — Add `scanUserSkills()` for `~/.claude/skills/`, `scanPluginSkills()` for `~/.claude/plugins/`, `isSkill` flag on execute response, security checks for new paths
- `server/claude-sdk.js` — Add `systemPrompt.append = options.skillContent` (do NOT include `taskOutputFallbackHint` — that belongs to Task 5)

### Enhancement 2: Multi-Command Input (~130 lines)

**Files:**
- `useChatComposerState.ts` — Replace single-command interception with regex-based multi-command extraction, sequential skill loading, combined skill content, auto-submit with remaining text

### Enhancement 3: Command Selection as Autocomplete (~60 lines)

**Files:**
- `useSlashCommands.ts` — Remove `onExecuteCommand` parameter, change `selectCommandFromKeyboard` and `handleCommandSelect` to insert command name into input instead of executing immediately
- `ChatInterface.tsx` — Remove `onExecuteCommand` prop threading (no longer needed)

### Supporting: Skill-Loaded Card Rendering

**Files:**
- `useChatComposerState.ts` — `setChatMessages` push `{ type: 'skill-loaded', ... }` when skill loads
- `MessageComponent.tsx` — Add skill-loaded card rendering (purple collapsible card)

---

## Changes to EXCLUDE

These appear in the feature branch diff but are NOT slash-command-specific:

| Change | Reason to exclude |
|--------|-------------------|
| Gemini removal (all files) | Upstream feature, must keep |
| `latestMessage` removal from ChatInterface | Unrelated refactor |
| `onSessionProcessing` callback → effect | Unrelated behavior change |
| Scroll-to-bottom interval during loading | UI improvement, unrelated |
| `taskOutputFallbackHint` in systemPrompt.append | Belongs to Task 5 (Background Tasks) |
| `CommandMenu.tsx` deletion | Keep upstream's TSX version |

---

## Implementation Steps

### Step 1: Create branch and verify baseline

```bash
git checkout main
git checkout -b feat/slash-commands-skills
npm install
npm run build  # verify clean baseline
```

### Step 2: Modify `server/routes/commands.js`

Add skill scanning functions and integrate into endpoints:

1. Add `scanUserSkills(skillsDir)` function (~40 lines) — scans `~/.claude/skills/` for `SKILL.md` files
2. Add `scanPluginSkills(pluginsDir)` function (~60 lines) — reads `installed_plugins.json`, scans each plugin's `skills/` dir
3. Modify `/list` endpoint — call both scan functions, append results to command list
4. Modify `/load` endpoint — expand security check to allow `.claude/skills/` and `.claude/plugins/`
5. Modify `/execute` endpoint — detect `isSkill` based on path, include in response

**Source of truth:** `git show feature/personal-enhancements:server/routes/commands.js`

### Step 3: Modify `server/claude-sdk.js`

Add skill content injection into system prompt:

1. Find the `sdkOptions` construction block (search for `systemPrompt`)
2. Add: `if (options.skillContent) { sdkOptions.systemPrompt.append = options.skillContent; }`
3. Do NOT include `taskOutputFallbackHint` (Task 5 specific)

**Caution:** Upstream did SDK upgrade (#446). Read current main version first to find correct injection point.

### Step 4: Modify `useSlashCommands.ts`

Change command selection from immediate-execute to autocomplete:

1. Remove `onExecuteCommand` from `UseSlashCommandsOptions` interface
2. Remove `onExecuteCommand` from function parameters
3. Remove `isPromiseLike` helper (no longer needed)
4. In `selectCommandFromKeyboard`: replace `onExecuteCommand(command)` with input insertion + cursor positioning
5. In `handleCommandSelect`: same replacement — insert command name, don't execute
6. Remove `selectedProject` null guard from `fetchCommands` (works without project)
7. Change `selectedProject.path` to `selectedProject?.path`

### Step 5: Modify `useChatComposerState.ts`

Add skill handling and multi-command parsing:

1. Add `pendingSkillContentRef = useRef<string | null>(null)`
2. Add to `CommandExecutionResult` interface: `command?`, `metadata?`, `isSkill?`, `userArgs?`
3. In `handleCustomCommand`: add skill path — if `isSkill`, show skill-loaded card, store/auto-submit
4. In `executeCommand`: pass `userArgs = argsText` to `handleCustomCommand` for custom results
5. Replace single-command interception in `handleSubmit` with multi-command regex extraction
6. Add `skillContent` to `claude-command` message: `skillContent: pendingSkillContentRef.current`
7. Remove `onExecuteCommand` from `useSlashCommands` call
8. **Do NOT remove** `geminiModel`, `onSessionProcessing`, `latestMessage` — those are unrelated

### Step 6: Modify `ChatInterface.tsx`

Remove `onExecuteCommand` prop threading:

1. Remove `onExecuteCommand` from the props passed to `useChatComposerState` (it no longer exists)
2. **Keep** all Gemini props, `latestMessage`, `onSessionProcessing` — don't touch unrelated code

### Step 7: Add skill-loaded card in `MessageComponent.tsx`

Add rendering for `message.type === 'skill-loaded'`:

1. Add purple collapsible card between system-injected and user message blocks
2. Show skill name, description, and content on expand

### Step 8: Build, verify, commit

```bash
npm run build
npm run typecheck
# Verify no Gemini code removed, no unrelated changes
git diff --stat HEAD
git add <specific files>
git commit -m "feat(chat): add skill support and multi-command input for slash commands"
git push -u origin feat/slash-commands-skills
gh pr create --repo siteboon/claudecodeui ...
```

---

## Checklist Per PR Rules

- [ ] Branch based on latest `main`
- [ ] No `debug:` commits
- [ ] No cross-feature changes (no Gemini removal, no scroll fixes, no background task code)
- [ ] `npm run build` passes
- [ ] `npm run typecheck` passes
- [ ] Commit messages follow Conventional Commits
- [ ] No `Co-Authored-By` lines

---

## Conflict Risk Assessment

| File | Risk | Strategy |
|------|------|----------|
| `commands.js` | Low | Pure additions, no upstream changes |
| `useSlashCommands.ts` | Low | Interface change + behavior change |
| `useChatComposerState.ts` | Medium | Large logic changes, must preserve Gemini code |
| `claude-sdk.js` | High | SDK upgrade changed structure — read current version carefully |
| `ChatInterface.tsx` | Medium | Component refactored in #402 — adapt to new structure |
| `MessageComponent.tsx` | Low | Adding new block (skill-loaded card) |

<div align="center">
  <img src="public/logo.svg" alt="CloudCLI UI" width="64" height="64">
  <h1>Claude Code UI — Personal Fork</h1>
  <p>Fork of <a href="https://github.com/siteboon/claudecodeui">siteboon/claudecodeui</a> (forked at v1.32.0).<br>
  A self-hosted UI for <a href="https://docs.anthropic.com/en/docs/claude-code">Claude Code</a>, <a href="https://docs.cursor.com/en/cli/overview">Cursor CLI</a>, <a href="https://developers.openai.com/codex">Codex</a>, and <a href="https://geminicli.com/">Gemini-CLI</a>.</p>
</div>

---

## Changes in this fork

### New features

- **Queued prompts** — submit a message while a session is active; it queues and fires automatically when the current task finishes. Banner shows the queued text with a cancel button. Queue clears on project or session switch to prevent cross-session leaks.
- **Collapsible tool blocks** — tool use blocks collapse by default with a one-line summary (tool name + first line of input). Expand individually or toggle all via Quick Settings.
- **Expandable activity feed** — status pill in the toolbar opens a terminal-style scrollable feed of recent tool activity.
- **Model selector in toolbar** — current model name displayed; click to change model without opening Settings.
- **Image lightbox** — click any image in the chat to open it fullscreen.
- **Pinned last user message** — last user prompt shown pinned at the top of the chat view for context while scrolling.
- **Prompt navigation panel** — navigate between your previous prompts in the current session.
- **Context usage pill** — visual indicator of token context usage in the chat toolbar.
- **Quick Settings panel** — fast access to common toggles (auto-scroll, expand tools, compact summaries, etc.) without opening full Settings.

### UX improvements

- **Restore input on early abort** — if ESC is pressed before the agent responds, the user message is removed and input is restored for editing.
- **Message timestamps show date + time** — was time-only; now shows `MM/DD HH:MM` so messages from previous days are identifiable.
- **Fork conversation from any message** — GitFork button on every message clears the session and pre-fills the input with that message's content, starting a new conversation branch. Button always visible (fixed hover-only opacity that was invisible on mobile).
- **Redesigned chat footer toolbar** — cleaner layout, better mobile spacing and touch targets.

### Bug fixes

- **Triple send on mobile with images** — submitting a message with an attached image fired `handleSubmit` 3× on one tap. Fixed with `isSubmittingRef` guard.
- **Shell sessions not syncing** — messages from terminal (`claude` CLI) were not updating in the UI. Fixed: removed `isLoading` guard blocking shell session refresh; reduced Chokidar polling 6 s → 2 s.
- **Shell open created new session** — opening `claude` in terminal caused a new blank session in the sidebar instead of auto-navigating to the shell session. Fixed with `projects_updated` add-event auto-switch.
- **Stale ESC abort closure** — pressing ESC to abort used a stale `chatMessages` reference, causing wrong behaviour if the re-render hadn't flushed yet. Fixed with `chatMessagesRef`.
- **Collapsed tool block showed blank** — tool block collapse preview was empty. Now shows `toolName: first line of input`.
- **Push notification body format** — improved title/body structure to include session name and provider context.

---

## Quick Start (Self-Hosted)

Requires **Node.js v22+**.

```bash
git clone https://github.com/szmidtpiotr/claudecodeui.git
cd claudecodeui
npm install
npm run build
npm start
```

Open `http://localhost:3001`.

For development:

```bash
npm run dev
```

---

## License

GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later) — see [LICENSE](LICENSE).

Upstream project: [siteboon/claudecodeui](https://github.com/siteboon/claudecodeui) · [CloudCLI](https://cloudcli.ai)

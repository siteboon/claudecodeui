# Reproduce a lost Codex failure without a model request

These fixtures use a fake executable through the real Codex SDK and an isolated
SQLite database. They do not call a model, change credentials, start CloudCLI,
or interrupt a running user session. Run them from this PR's checkout, with
Node.js 22+ and dependencies installed (`npm ci` if needed):

```sh
npx --no-install tsx --tsconfig server/tsconfig.json --test \
  --test-name-pattern='real SDK subprocess reports exit-zero|failure survives database reopen' \
  server/modules/providers/tests/codex-run-failure.test.ts \
  server/modules/providers/tests/codex-run-failure-history.test.ts
```

1. The SDK subprocess fixture emits `thread.started`, then exits with code 0
   **without** `turn.completed`. This deliberately reproduces a cut-off reply;
   there is no need to cause an intermittent real network failure.
2. Before this PR, that unfinished stream is reported as a successful completion
   and no failure is journaled. With this PR, the fixture asserts one error,
   one completion with exit code 1, and one saved failure.
3. The history fixture separately saves a failure, closes and reopens its test
   database, then loads history. It asserts the notice appears exactly once,
   including on a paginated read and when no native rollout exists. This models
   reopening the page after the live error was missed.

Both selected tests should pass on this branch. Other tests are filtered out by
the name pattern. The runtime fixture captures WebSocket messages; it does not
open a browser. The history fixture tests persistence independently, rather
than claiming to reproduce the original external transport fault end to end.

For the other failure cases and review regressions, run both files without
`--test-name-pattern`. They include an unexpected transport `AbortError`,
preparation failure, failure followed by Stop, edit/rewind cleanup, broken
inherited history, and setup guidance in live and saved notices.

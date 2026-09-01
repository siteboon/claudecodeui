# 05 — History fetch performance

**Status:** OPEN · **Depends on:** nothing · **Independent**
**Findings:** O18 · **Upstream:** unclaimed

Lowest priority of the five — a real cost, but nothing breaks.

## The defect

`fetchHistory` reads and JSON-parses the entire session JSONL *plus every*
`agent-*.jsonl`, normalizes all of it, then slices ~20 rows — on **every
paginated request**. Grep for `mtime|cache` in
`claude-sessions.provider.ts`: **zero hits.**

The original handover also reports that `total` excludes `tool_result` rows
while `sliceTailPage` paginates over an array that includes them, so the count
and the page indices are computed over different populations. **Unverified —
confirm before fixing.** If true, `Workflow` transcripts are affected worst,
since they are dominated by `tool_result` rows.

## Approach

Cache parsed transcripts keyed on `(path, mtime, size)`. Bound the cache — a
session with many large agent transcripts is exactly the case that motivates
the cache and also the one that would blow memory if it is unbounded (see `02`).

Separately, confirm and fix the `total`-vs-slice population mismatch.

## Verification

Time a paginated scroll through a large `Workflow` transcript before and after.
Confirm page boundaries are stable — no duplicated or skipped rows — which is
what a population mismatch would show up as.

# 05 — History fetch performance

**Status:** OPEN · **Depends on:** nothing · **Independent**
**Findings:** O18 · **Upstream:** unclaimed

Filed as the lowest priority of the five — a real cost, but nothing breaks.
**Measured 2026-09-18 and that reading no longer holds:** this is what produces
"the session is stuck" reports in daily use. See `plan/local/T23`.

## The defect

`fetchHistory` reads and JSON-parses the entire session JSONL *plus every*
`agent-*.jsonl`, normalizes all of it, then slices ~20 rows — on **every
paginated request**. Grep for `mtime|cache` in
`claude-sessions.provider.ts`: **zero hits.**

The original handover also reports that `total` excludes `tool_result` rows
while `sliceTailPage` paginates over an array that includes them, so the count
and the page indices are computed over different populations.

**Checked 2026-09-18 — the premise is gone.** Normalized history carries no
`tool_result` rows at all: session `981b3310` (4,662 JSONL rows) normalizes to
763 `tool_use` and 216 `text`, and nothing else. Results are folded onto the
`tool_use` as `toolResult`. There are no two populations to drift apart, so
this question closes rather than gets fixed.

## Approach

Cache parsed transcripts keyed on `(path, mtime, size)`. Bound the cache — a
session with many large agent transcripts is exactly the case that motivates
the cache and also the one that would blow memory if it is unbounded (see `02`).

**The cache fixes parse cost, not payload weight.** The same session normalizes
to **5,490 KB** of JSON, and results are what fill it: `toolUseResult` is 2,413
KB (44%) and result `content` another 1,422 KB (26%), against 1,120 KB of
`toolInput`. Served from a perfect cache, those megabytes still reach the
client. Trimming what a history row carries is separate work, measured and
planned in `plan/local/T23` — where the lever is that all 2,413 KB of
`toolUseResult` exist for two fields the client actually reads.

## Verification

Time a paginated scroll through a large `Workflow` transcript before and after.
Confirm page boundaries are stable — no duplicated or skipped rows — which is
what a population mismatch would show up as.

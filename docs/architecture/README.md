# Chat runtime architecture — two variations

Two independently written documentation sets cover the same six subsystems: the
websocket transport, conversation handoff, the realtime stream, scrolling, lazy loading,
and tool views. They were produced concurrently by two separate sessions and are kept
side by side so the better one can be chosen, or the two merged.

Pick one and read it end to end. Do not read both at once — they use slightly different
names for the same things, which is exactly the confusion this documentation exists to
remove.

| | [variation-1](./variation-1/README.md) | [variation-2](./variation-2/README.md) |
| --- | --- | --- |
| Size | 3,626 lines, 7 files | 2,499 lines, 7 files |
| Diagrams | 25 | 18 |
| Citation style | file path + symbol name | file path + `:line`, symbol named in prose |
| Message store | its own document, merged with lazy loading | split across the handoff and stream documents |
| Scrolling and lazy loading | separate documents | separate documents |
| Fact-checked against source | yes — every claim re-verified in an adversarial pass | not by this session |

Both sets are internally complete: every cross-link resolves inside its own folder, and
every mermaid diagram in both was parsed with the repo's own `mermaid` package.

**On verification.** The claims in `variation-1` were checked against the current source
a second time by reviewers whose job was to find errors, and that pass corrected real
mistakes — behaviour attributed to the wrong file, a cited function that did not exist,
wrong constants, and one gotcha documented backwards from a reverted commit.
`variation-2` was written with care and its diagrams and links are sound, but this
session did not re-verify its factual claims against the code.

## Document map

| Subsystem | variation-1 | variation-2 |
| --- | --- | --- |
| WebSocket transport | `01-websocket-transport.md` | `01-websocket-layer.md` |
| Realtime stream | `02-realtime-stream.md` | `03-realtime-stream.md` |
| Conversation handoff | `03-conversation-handoff.md` | `02-conversation-handoff.md` |
| Message store and lazy loading | `04-message-store-and-lazy-loading.md` | `05-lazy-loading.md` |
| Scrolling | `05-scrolling.md` | `04-scrolling.md` |
| Tool views | `06-tool-view.md` | `06-tool-views.md` |

## Related module docs

These remain authoritative for their own module's API surface; the sets above explain how
the pieces fit together.

- `server/modules/websocket/README.md` — the gateway's service map.
- `server/modules/providers/README.md` — the provider abstraction.
- `src/modules/chat/tools/README.md` — the tool config registry, from the module's side.

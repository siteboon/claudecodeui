# Vault — Home Hub

> Central index for this research vault. Start here.

**Model:** `claude-sonnet-4-6` | **Updated:** 2026-02-27

---

## Navigation

| Section | Description |
|---------|-------------|
| [[Timeline]] | Chronological research log |
| [[Findings/README\|Findings]] | Raw OSINT results and evidence |
| [[People/README\|People]] | Person profiles and connections |
| [[Locations/README\|Locations]] | Location notes and maps |
| [[obsidian]] | Vault setup and plugin configuration |

---

## Quick Links

- [[Templates/person-template]] — Start a new person profile
- [[Templates/finding-template]] — Log a new finding
- [[Templates/timeline-entry]] — Add a timeline entry

---

## Graph View

Open with the graph icon in the left sidebar to see all note connections. Look for:
- **Clusters** — related people / events / locations
- **Hub nodes** — heavily linked notes (key figures or events)
- **Orphaned nodes** — notes with no links yet (review these)

---

## Tags in Use

| Tag | Meaning |
|-----|---------|
| `#person` | Individual profile |
| `#location` | Place or venue |
| `#event` | Dated occurrence |
| `#finding` | Verified OSINT result |
| `#claim` | Unverified claim — needs sourcing |
| `#myth` | Debunked or highly disputed claim |
| `#document` | Primary source document reference |

---

## Dataview — Overview

All tagged findings:
```dataview
TABLE date, summary, tags FROM "Findings"
SORT date DESC
```

All people:
```dataview
LIST FROM #person
SORT file.name ASC
```

---

## Workflow

1. Vault opens → Obsidian Git auto-pulls latest
2. Add new notes → link back to this hub
3. Auto-commit & push every 5–10 minutes via Obsidian Git
4. Use Graph view to discover new connections
5. Periodic backup: copy vault folder to secondary storage

---

## Setup Status

- [x] Vault folder created
- [x] Core plugins enabled
- [x] obsidian.md setup guide written
- [ ] Community plugins installed (see [[obsidian]])
- [ ] Git remote connected
- [ ] Templates configured

---

*See [[obsidian]] for full setup instructions.*

# Obsidian Vault Setup Guide

> Configuration and setup reference for this research vault.

## Quick Start

1. Open Obsidian → **Vault Switcher** → Open existing vault → point to this `vault/` folder
2. Enable core plugins (see below)
3. Install community plugins (see below)
4. Run `Obsidian Git: Initialize repository` from command palette

---

## Core Plugins (Built-in, Free)

Enable these in **Settings → Core Plugins**:

| Plugin | Purpose |
|--------|---------|
| Backlinks | See all notes linking to the current note |
| Graph view | Visualize connections between notes |
| Outgoing links | See what the current note links to |
| Templates | Insert pre-built note templates |
| Daily notes | Optional: research log / journal |

---

## Community Plugins (All Free)

Install via **Settings → Community Plugins → Browse**:

| Plugin | Purpose |
|--------|---------|
| **Dataview** | Query notes like a database — list by tag, date, field |
| **Obsidian Git** | Auto-commit & push to Git repo (backup + sync) |
| **Templater** | Powerful templates with variables and scripts |
| **Advanced Tables** | Better table editing in Markdown |
| **Excalidraw** | Visual canvas and mind maps embedded in notes |
| **Markmap** | Auto-generate mind maps from note headings |

---

## Obsidian Git Configuration

After installing Obsidian Git:

**Settings → Obsidian Git:**
- Auto commit interval: `5` minutes
- Auto push after commit: `Yes`
- Pull changes on startup: `Yes`

**First-time setup (Command Palette `Ctrl/Cmd+P`):**
```
Obsidian Git: Initialize repository
Obsidian Git: Add remote
```

Paste remote URL → push (use GitHub Personal Access Token when prompted).

**Get a token:** GitHub → Settings → Developer settings → Personal access tokens → Generate new → select `repo` scope → copy.

---

## .gitignore for Vault

Create `.gitignore` in vault root:

```
.obsidian/workspace*
.trash/
*.pdf
*.zip
.DS_Store
Thumbs.db
```

---

## Folder Structure

```
vault/
├── obsidian.md              ← this file (setup guide)
├── vault.md                 ← vault index & home hub
├── Timeline.md              ← chronological entries
├── Findings/                ← OSINT results, raw notes
│   └── README.md
├── People/                  ← person profiles
│   └── README.md
├── Locations/               ← location notes
│   └── README.md
└── Templates/               ← note templates
    ├── person-template.md
    ├── finding-template.md
    └── timeline-entry.md
```

---

## Linking Convention

Use `[[WikiLinks]]` for all cross-note references:

```markdown
- [[vault]] – home hub
- [[Timeline]] – chronological view
- [[Findings/README]] – OSINT folder
```

Obsidian auto-creates blank stub notes when you click a red link — fill them in later.

---

## Dataview Queries

List all notes tagged `#person`:
````markdown
```dataview
LIST FROM #person
SORT file.name ASC
```
````

List all findings by date:
````markdown
```dataview
TABLE date, summary FROM "Findings"
SORT date DESC
```
````

---

## Multi-Device Sync

1. Clone the Git repo on each device
2. Open vault folder in Obsidian
3. Work offline → push when online
4. Obsidian Git auto-pulls on startup

---

## Security (Optional)

Encrypt vault with [Cryptomator](https://cryptomator.org/) (free):
1. Create encrypted Cryptomator vault container
2. Put Obsidian vault inside
3. Git the encrypted files

---

*Related: [[vault]] · [[Templates/person-template]] · [[Templates/finding-template]]*

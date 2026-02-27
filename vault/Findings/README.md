# Findings

> Raw OSINT results, verified facts, and sourced evidence.

*Add findings using [[../Templates/finding-template]]*

---

## Index

```dataview
TABLE date, summary, tags FROM "Findings"
WHERE file.name != "README"
SORT date DESC
```

---

## Verification Levels

| Tag | Meaning |
|-----|---------|
| `#finding` | Verified — multiple independent sources |
| `#claim` | Unverified — single source or contested |
| `#myth` | Debunked or no credible sourcing |

---

*Related: [[../vault]] · [[../People/README]] · [[../Timeline]]*

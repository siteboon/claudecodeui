# Phase 2: Lazy Loading Architecture - Research

**Researched:** 2026-01-24
**Domain:** Node.js filesystem-based lazy loading with deferred API data fetching
**Confidence:** HIGH

## Summary

This phase implements lazy loading architecture for a Node.js/Express application that manages Claude Code session data stored as JSONL files. The goal is to extract minimal metadata from the filesystem without parsing file contents, deferring detailed session summaries to separate API calls.

Research reveals that Node.js provides native filesystem APIs optimized for metadata-only operations (`fs.readdir` with `withFileTypes`, `fs.stat`), eliminating the need to read file contents. The architecture pattern centers on progressive disclosure: initial API responses contain only what's needed to render the project list (file count, total size from filesystem stats), while detailed session data is fetched on-demand when users expand projects.

Key technical approach:
1. Use `fs.readdir` with `withFileTypes: true` to avoid additional stat calls
2. Extract session count and timestamps from JSONL filenames alone
3. Use `fs.stat` to get file sizes without reading content
4. Design separate REST endpoint (or parameterized loading) for session summaries
5. Leverage existing byte-limited reading infrastructure from Phase 1

**Primary recommendation:** Use filesystem metadata extraction via `readdir` with `withFileTypes` and `stat` operations, combined with a separate `/api/projects/:name/sessions` endpoint for deferred session summary loading.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js fs/promises | Node v18+ | Filesystem operations | Native, optimized for async metadata extraction |
| Express.js | 4.18+ | REST API framework | Industry standard for Node.js APIs, existing codebase uses it |
| fs.Dirent | Node v18+ | Directory entry objects | Avoids redundant stat calls via `withFileTypes: true` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| graceful-fs | 4.x | EMFILE error handling | Large directories with many concurrent operations |
| async/p-limit | Latest | Concurrency control | Batching stat operations to avoid overwhelming filesystem |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Separate endpoint | Query parameter (`?include=sessions`) | Query param simpler for single optional expansion, separate endpoint cleaner for complex resources |
| fs callback API | fs/promises | Callbacks have better max performance (per Node.js docs), promises more readable in async code |
| Custom batching | Native Promise.all | Custom batching adds complexity, Promise.all sufficient unless hitting EMFILE errors |

**Installation:**
No additional packages required - use Node.js native `fs/promises` module.

Optional for production resilience:
```bash
npm install graceful-fs  # Only if encountering EMFILE errors
```

## Architecture Patterns

### Recommended Project Structure
```
server/
├── routes/
│   └── projects.js         # API endpoints
├── projects.js             # Core project logic
└── utils/
    └── filesystem.js       # Metadata extraction utilities
```

### Pattern 1: Metadata-Only Filesystem Scanning

**What:** Extract file count, total size, and timestamps from filesystem without reading JSONL content

**When to use:** Initial project list loading, computing stats for project cards

**Example:**
```javascript
// Source: Node.js official documentation + current codebase pattern
import { readdir, stat } from 'fs/promises';
import path from 'path';

async function getProjectMetadata(projectDir) {
  // Use withFileTypes to avoid redundant stat calls
  const entries = await readdir(projectDir, { withFileTypes: true });

  // Filter JSONL files without opening them
  const jsonlFiles = entries.filter(e =>
    e.isFile() && e.name.endsWith('.jsonl') && !e.name.startsWith('agent-')
  );

  let totalSize = 0;
  let lastModified = null;

  // Batch stat operations for file sizes
  for (const entry of jsonlFiles) {
    const filePath = path.join(projectDir, entry.name);
    const stats = await stat(filePath);
    totalSize += stats.size;

    if (!lastModified || stats.mtime > lastModified) {
      lastModified = stats.mtime;
    }
  }

  return {
    sessionCount: jsonlFiles.length,
    totalSizeBytes: totalSize,
    lastActivity: lastModified
  };
}
```

### Pattern 2: Filename-Based Session List Derivation

**What:** Extract session IDs and basic info from JSONL filenames without parsing content

**When to use:** Generating initial session list for project without detailed summaries

**Example:**
```javascript
// Source: Existing codebase pattern adapted for filename-only extraction
async function getSessionListFromFilenames(projectDir) {
  const entries = await readdir(projectDir, { withFileTypes: true });

  const sessions = await Promise.all(
    entries
      .filter(e => e.isFile() && e.name.endsWith('.jsonl') && !e.name.startsWith('agent-'))
      .map(async (entry) => {
        const filePath = path.join(projectDir, entry.name);
        const stats = await stat(filePath);

        return {
          filename: entry.name,
          // Session ID can be derived from filename if naming convention exists
          // Or set to null/placeholder for deferred loading
          id: null,
          lastActivity: stats.mtime,
          // Summary explicitly marked as not loaded
          summaryLoaded: false
        };
      })
  );

  return sessions.sort((a, b) => b.lastActivity - a.lastActivity);
}
```

### Pattern 3: Deferred Data Loading Endpoint

**What:** Separate API endpoint that loads detailed session summaries only when requested

**When to use:** User expands a project in sidebar, requiring session summaries

**Example:**
```javascript
// Source: REST API lazy loading patterns + Express best practices
// Option A: Separate endpoint (RECOMMENDED for clarity)
router.get('/api/projects/:projectName/sessions', async (req, res) => {
  const { projectName } = req.params;
  const { limit = 10, offset = 0 } = req.query;

  // Now parse JSONL files to get summaries (existing getSessions logic)
  const result = await getSessions(projectName, limit, offset);

  res.json(result);
});

// Option B: Query parameter on main endpoint
router.get('/api/projects', async (req, res) => {
  const { includeSessions = 'false' } = req.query;

  const projects = await getProjectsMinimal(); // Metadata only

  if (includeSessions === 'true') {
    // Load sessions for all projects (likely too expensive)
    for (const project of projects) {
      project.sessions = await getSessions(project.name, 5, 0);
    }
  }

  res.json(projects);
});
```

### Pattern 4: Batched Filesystem Operations

**What:** Process stat calls in controlled batches to avoid EMFILE errors

**When to use:** Large directories with hundreds of session files

**Example:**
```javascript
// Source: Node.js EMFILE prevention best practices
async function batchedStats(filePaths, batchSize = 50) {
  const results = [];

  for (let i = 0; i < filePaths.length; i += batchSize) {
    const batch = filePaths.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(filepath => stat(filepath).catch(err => null))
    );
    results.push(...batchResults);
  }

  return results;
}
```

### Anti-Patterns to Avoid

- **Reading entire JSONL files for counts:** Never use `readFile` or full stream parsing just to count sessions - use `readdir` instead
- **Synchronous filesystem operations in routes:** Blocks event loop - always use async versions
- **Returning all sessions by default:** Always paginate and lazy-load detailed data
- **Multiple stat calls when withFileTypes available:** Use `readdir({ withFileTypes: true })` to avoid redundant stat operations

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File descriptor exhaustion | Custom retry logic | `graceful-fs` module | Handles EMFILE errors with automatic back-off, drop-in fs replacement |
| Concurrent operation limiting | Manual semaphore/queue | `p-limit` or `async.mapLimit` | Battle-tested, handles edge cases like errors and cancellation |
| Pagination logic | Custom offset/limit math | Established pattern (slice with offset) | Easy to get edge cases wrong (empty results, negative offsets) |
| File size formatting | String concatenation | `bytes` npm package or simple helper | Handles KB/MB/GB conversions, locale formatting |

**Key insight:** Filesystem operations at scale have many edge cases (symlinks, permissions, EMFILE limits, race conditions). Native Node.js APIs handle most scenarios; only add libraries when hitting specific limits.

## Common Pitfalls

### Pitfall 1: EMFILE - Too Many Open Files

**What goes wrong:** Opening hundreds of files concurrently (via Promise.all with stat/readFile) exhausts OS file descriptor limit, causing EMFILE error

**Why it happens:** Node.js allows unlimited concurrent async operations, but OS limits open file descriptors (typically 256-1024 on macOS, 1024+ on Linux)

**How to avoid:**
- Batch filesystem operations (50-100 at a time)
- Use `graceful-fs` as drop-in replacement that auto-retries
- Close file handles explicitly when using FileHandle API
- Use streaming APIs instead of reading entire files

**Warning signs:** "EMFILE, too many open files" error, especially with large project directories

**Detection:** Monitor concurrent fs operations during development with large test datasets

### Pitfall 2: Callback vs Promise Performance Trade-off

**What goes wrong:** Choosing promises for "cleaner code" when application hits performance bottlenecks in hot paths

**Why it happens:** Per Node.js docs: "callback-based versions...are preferable...when maximal performance...is required" - promises have overhead

**How to avoid:**
- Use promises for most code (better readability)
- Profile actual performance before optimizing
- Only switch to callbacks in proven bottlenecks (e.g., scanning thousands of files)
- Document why callbacks used when not following codebase convention

**Warning signs:** Slow `/api/projects` response times, high event loop latency during filesystem scans

### Pitfall 3: withFileTypes Not Used, Redundant Stat Calls

**What goes wrong:** Calling `readdir()` without `withFileTypes: true`, then manually calling `stat()` on each entry to check if it's a file/directory

**Why it happens:** Not aware that `readdir` can return Dirent objects with type information included

**How to avoid:**
- Always use `readdir(path, { withFileTypes: true })`
- Use `dirent.isFile()`, `dirent.isDirectory()` methods instead of separate stat calls
- Only call stat when you need size/timestamps/permissions beyond file type

**Warning signs:** Multiple stat calls per file in performance traces, slow directory scanning

### Pitfall 4: Parsing JSONL Files for Session Count

**What goes wrong:** Reading and parsing JSONL files line-by-line just to count how many sessions exist in a project

**Why it happens:** Thinking you need to open files to count them, not realizing filename list = session count

**How to avoid:**
- Count JSONL files from `readdir` result, not by parsing content
- Only parse JSONL when you need session summaries/messages
- Use filesystem metadata (mtime, size) for project-level stats

**Warning signs:** High memory usage during project loading, slow initial API response despite lazy loading goal

### Pitfall 5: Breaking Change Without Migration Path

**What goes wrong:** Changing `/api/projects` response shape (removing `sessions` array) breaks existing frontend code

**Why it happens:** Assuming client and server are always deployed together, but WebSocket connections may have cached clients

**How to avoid:**
- Per CONTEXT.md: "No backward compatibility needed" - client/server deployed together
- Still make response shape additive when possible
- Test full UI workflow after API changes to catch integration issues

**Warning signs:** Console errors in browser after API changes, missing data in UI

### Pitfall 6: Not Handling Symlinks Properly

**What goes wrong:** Following symlinks into system directories or infinite loops, or treating symlinks as regular files when counting sessions

**Why it happens:** `readdir` by default follows symlinks, and stat resolves symlink targets

**How to avoid:**
- Use `lstat` instead of `stat` to get symlink info without following
- Check `dirent.isSymbolicLink()` when using withFileTypes
- Skip or explicitly handle symlinks in session directories

**Warning signs:** Infinite loops during directory scanning, accessing unexpected system paths

## Code Examples

Verified patterns from official sources:

### Minimal Project Metadata Extraction

```javascript
// Source: Node.js fs API documentation + current codebase patterns
import { readdir, stat } from 'fs/promises';
import path from 'path';
import os from 'os';

async function getProjectsMinimal() {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  const entries = await readdir(claudeDir, { withFileTypes: true });

  const projects = await Promise.all(
    entries
      .filter(e => e.isDirectory())
      .map(async (entry) => {
        const projectPath = path.join(claudeDir, entry.name);
        const metadata = await getProjectMetadata(projectPath);

        return {
          name: entry.name,
          sessionCount: metadata.sessionCount,
          totalSize: metadata.totalSizeBytes,
          lastActivity: metadata.lastActivity,
          // Sessions array explicitly omitted - load separately
        };
      })
  );

  return projects;
}

async function getProjectMetadata(projectDir) {
  const entries = await readdir(projectDir, { withFileTypes: true });
  const jsonlFiles = entries.filter(e =>
    e.isFile() && e.name.endsWith('.jsonl') && !e.name.startsWith('agent-')
  );

  let totalSize = 0;
  let lastModified = null;

  // Get stats for each file
  for (const entry of jsonlFiles) {
    const filePath = path.join(projectDir, entry.name);
    const stats = await stat(filePath);
    totalSize += stats.size;

    if (!lastModified || stats.mtime > lastModified) {
      lastModified = stats.mtime;
    }
  }

  return {
    sessionCount: jsonlFiles.length,
    totalSizeBytes: totalSize,
    lastActivity: lastModified || new Date()
  };
}
```

### Deferred Session Loading Endpoint

```javascript
// Source: Express routing best practices + REST API lazy loading patterns
import express from 'express';
import { getSessions } from '../projects.js'; // Existing function

const router = express.Router();

// Separate endpoint for session summaries (RECOMMENDED)
router.get('/api/projects/:projectName/sessions', async (req, res) => {
  try {
    const { projectName } = req.params;
    const { limit = 10, offset = 0 } = req.query;

    // Use existing getSessions function that parses JSONL
    const result = await getSessions(projectName, parseInt(limit), parseInt(offset));

    res.json({
      sessions: result.sessions,
      pagination: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        hasMore: result.hasMore
      }
    });
  } catch (error) {
    console.error('Error loading sessions:', error);
    res.status(500).json({ error: 'Failed to load sessions' });
  }
});

export default router;
```

### Batched Stat Operations (EMFILE Prevention)

```javascript
// Source: Node.js EMFILE prevention best practices
async function getFileStats(filePaths, batchSize = 50) {
  const results = [];

  // Process in batches to avoid EMFILE
  for (let i = 0; i < filePaths.length; i += batchSize) {
    const batch = filePaths.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (filepath) => {
        try {
          return await stat(filepath);
        } catch (error) {
          // Handle individual file errors gracefully
          console.warn(`Failed to stat ${filepath}:`, error.message);
          return null;
        }
      })
    );
    results.push(...batchResults.filter(Boolean));
  }

  return results;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Parse all JSONL on load | Filesystem metadata only | Phase 2 (this phase) | 10-100x faster initial load for large projects |
| Single monolithic endpoint | Separate session endpoint | Phase 2 (this phase) | Enables progressive loading in UI |
| Promise.all unlimited | Batched operations | When hitting EMFILE | Prevents file descriptor exhaustion |
| readdir + stat separately | readdir with withFileTypes | Node.js 10.10+ (2018) | Eliminates redundant stat syscalls |
| Callback-based fs | fs/promises | Node.js 10+ (2018), standard since 14+ | Cleaner async/await code |

**Deprecated/outdated:**
- `fs.exists`: Use `fs.access` or handle ENOENT errors instead
- Synchronous fs calls in API routes: Always use async versions to avoid blocking event loop
- Reading full files for metadata: Use stat/readdir instead

## Open Questions

Things that couldn't be fully resolved:

1. **Session ID from Filename Pattern**
   - What we know: Current codebase uses JSONL filenames but may not encode session ID in name
   - What's unclear: Whether session IDs can be reliably derived from filenames without opening files
   - Recommendation: Investigate filename structure; if session ID not in filename, store separate session-to-file mapping or accept that session list shows filenames until expanded

2. **Optimal Batch Size for Stat Operations**
   - What we know: Too many concurrent stats cause EMFILE, batching prevents this
   - What's unclear: Optimal batch size varies by OS (macOS ~256, Linux ~1024 file descriptors)
   - Recommendation: Start with batch size of 50, make configurable via environment variable for tuning

3. **Cache Invalidation Strategy**
   - What we know: Phase 1 has `projectDirectoryCache` for cwd extraction
   - What's unclear: Whether to cache metadata (session count, size) and how to invalidate when files change
   - Recommendation: Initially don't cache metadata (fast enough from filesystem), revisit if performance issues arise

4. **Graceful-fs Necessity**
   - What we know: graceful-fs is drop-in replacement for handling EMFILE
   - What's unclear: Whether current project scale requires it or if batching alone sufficient
   - Recommendation: Start without graceful-fs, add only if EMFILE errors occur in production

## Sources

### Primary (HIGH confidence)
- [Node.js fs API Documentation](https://nodejs.org/api/fs.html) - Official Node.js v25 documentation
- [Express.js Routing Guide](https://expressjs.com/en/guide/routing.html) - Official Express routing documentation
- Current codebase (`projects.js`, `routes/projects.js`) - Established patterns in production

### Secondary (MEDIUM confidence)
- [How to Use fs.readdir in Node.js - BrowserStack](https://www.browserstack.com/guide/fs-readdir-in-node-js) - Performance best practices verified against official docs
- [Node.js Working with folders](https://nodejs.org/en/learn/manipulating-files/working-with-folders-in-nodejs) - Official learning guide
- [How to avoid "Too many open files" error in NodeJS - DEV Community](https://dev.to/zenulabidin/how-to-avoid-too-many-open-files-error-in-nodejs-2586) - EMFILE prevention strategies
- [REST API Design Best Practices - Strapi](https://strapi.io/blog/restful-api-design-guide-principles-best-practices) - Field filtering and minimal payloads
- [Best practices for REST API design - Stack Overflow](https://stackoverflow.blog/2020/03/02/best-practices-for-rest-api-design/) - Pagination patterns
- [Lazy Loading API Optimization - Datatas](https://datatas.com/how-to-optimize-api-response-times-with-lazy-loading/) - Progressive disclosure patterns

### Tertiary (LOW confidence - needs validation)
- [JSONL Tutorial - Complete Guide](https://jsonl.rest/tutorial/) - General JSONL patterns, not Node.js specific
- Various blog posts on API design - General principles, verify against official Express docs in implementation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Using native Node.js fs APIs and existing Express setup
- Architecture: HIGH - Patterns verified against Node.js official docs and current codebase
- Pitfalls: MEDIUM-HIGH - EMFILE and performance issues well-documented, some project-specific details need validation

**Research date:** 2026-01-24
**Valid until:** ~90 days (stable domain - Node.js fs APIs don't change frequently)

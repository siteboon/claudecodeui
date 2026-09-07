import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';

import { sessionsDb } from '@/modules/database/index.js';
import { OMP_ADVISOR_SIDECAR_PATTERN } from '@/modules/providers/list/omp/omp-session-files.js';
import {
  buildCloudCliSessionName,
  findFilesRecursivelyCreatedAfter,
  normalizeSessionName,
  readFileTimestamps,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';
import type { IProviderSessionSynchronizer } from '@/shared/interfaces.js';

type ParsedSession = {
  sessionId: string;
  projectPath: string;
  sessionName?: string;
  /** True only when the transcript contains a provider title, not the fallback. */
  hasProviderTitle: boolean;
  /** omp's own attribution for the title: `user` for a rename, `auto` otherwise. */
  titleSource?: string;
  /** Four-word title CloudCLI generated from the first visible user message. */
  provisionalSessionName?: string;
};

const UNTITLED = 'Untitled omp Session';

/**
 * Maps `<ts>_<id>/__advisor.<name>.jsonl` back to the `<ts>_<id>.jsonl` that
 * owns it, deriving the owner the same way the history reader derives the
 * sidecar directory from a main transcript path: by the `.jsonl` suffix alone.
 * Nothing here may assume a shape for the native id — the header parser accepts
 * whatever omp wrote, and an id-shaped guard here would silently deny those
 * sessions the broadcast. An existing owning transcript is the whole condition,
 * so unrelated `__` files stay ignored.
 */
function resolveOmpSidecarParent(filePath: string): string | null {
  if (!OMP_ADVISOR_SIDECAR_PATTERN.test(path.basename(filePath))) {
    return null;
  }

  const parentTranscript = `${path.dirname(filePath)}.jsonl`;
  return fs.existsSync(parentTranscript) ? parentTranscript : null;
}

// omp asks its title model for this wrapper. A failed extraction can persist
// the opening tag by itself, so remove wrappers from auto-generated titles.
const OMP_AUTO_TITLE_WRAPPER_PATTERN = /<\/?title(?:\s[^>]*)?(?:>|$)/gi;

function normalizeOmpProviderTitle(
  title: string | undefined,
  source: string | undefined,
): string | undefined {
  if (!title || source === 'user') {
    return title;
  }
  return title.replace(OMP_AUTO_TITLE_WRAPPER_PATTERN, ' ').trim() || undefined;
}

function readProvisionalSessionName(entry: Record<string, unknown>): string | undefined {
  if (entry.type !== 'message') {
    return undefined;
  }

  const message = readObjectRecord(entry.message);
  if (readOptionalString(message?.role) !== 'user') {
    return undefined;
  }

  const content = message?.content;
  if (typeof content === 'string') {
    return buildCloudCliSessionName(content);
  }
  if (!Array.isArray(content)) {
    return undefined;
  }

  let text = '';
  for (const part of content) {
    if (typeof part === 'string') {
      text += part;
      continue;
    }
    const record = readObjectRecord(part);
    if (typeof record?.text === 'string') {
      text += record.text;
    }
  }
  return text ? buildCloudCliSessionName(text) : undefined;
}

/**
 * Session indexer for omp ACP transcripts.
 *
 * omp persists each session as `~/.omp/agent/sessions/<cwd-slug>/<ts>_<id>.jsonl`.
 * agent.db has NO sessions table, so the jsonl store is the source of truth
 * (Claude-style scan, not the Hermes SQLite one). The `type:'session'` header
 * carries `{id, cwd, timestamp}`, a `type:'title'` entry carries the provider
 * title, and the first visible user message supplies CloudCLI's provisional title.
 */
export class OmpSessionSynchronizer implements IProviderSessionSynchronizer {
  private readonly provider = 'omp' as const;
  private readonly sessionsRoot = path.join(os.homedir(), '.omp', 'agent', 'sessions');

  async synchronize(since?: Date): Promise<number> {
    if (!fs.existsSync(this.sessionsRoot)) {
      return 0;
    }
    const files = await findFilesRecursivelyCreatedAfter(this.sessionsRoot, '.jsonl', since ?? null);

    let processed = 0;
    // Owners already synchronized by this scan. A sidecar is not a session; it
    // stands in for the transcript that owns it, and this scan usually reaches
    // that transcript directly as well. Resolving without deduplicating would
    // re-synchronize an owner once per sidecar it owns — the whole per-file
    // scan, multiplied, on the one path that walks every file under the root.
    // Skipping sidecars outright would be cheaper still, but an incremental
    // scan only sees files born since its cursor, so a new sidecar is the one
    // thing that can bring an older, not-yet-indexed owner back into view.
    const synchronizedOwners = new Set<string>();
    for (const filePath of files) {
      const owner = path.basename(filePath).startsWith('__')
        ? resolveOmpSidecarParent(filePath)
        : filePath;
      if (!owner || synchronizedOwners.has(owner)) {
        continue;
      }
      synchronizedOwners.add(owner);
      if (await this.synchronizeFile(owner)) {
        processed += 1;
      }
    }
    return processed;
  }

  async synchronizeFile(filePath: string): Promise<string | null> {
    if (!filePath.endsWith('.jsonl')) {
      return null;
    }

    if (path.basename(filePath).startsWith('__')) {
      // A sidecar is never a session of its own, but `readNormalizedOmpHistory`
      // folds its advisor notes into the owning transcript, so its content is
      // part of that session's history. Index the owner instead. The watcher
      // drops any event whose sync reported nothing indexed, so returning null
      // here left a turn that wrote only advisor output with no
      // `session_upserted`, and an open chat never learned that the history it
      // was showing had changed.
      const parentTranscript = resolveOmpSidecarParent(filePath);
      return parentTranscript ? this.synchronizeFile(parentTranscript) : null;
    }

    const parsed = await this.parseSessionHeader(filePath);
    if (!parsed) {
      return null;
    }

    // omp keeps the CURRENT title on the `type:'title'` header it rewrites in
    // place (that entry's `pad` field is a fixed-width slot for exactly this), so
    // every watcher tick reads the live title, and a retitle mid-session shows up
    // here. Which name wins is the question, and there are two owners: omp and
    // the user renaming the session in CloudCLI.
    //
    // `provider_name` is the last title read out of the jsonl. A stored name
    // that differs from that watermark is a local rename, except for the
    // provisional four-word name CloudCLI generated before omp wrote a title.
    // The synchronizer recognizes that provisional name from the first user
    // message, so existing app-created sessions can adopt omp's canonical title
    // without allowing later app renames to be overwritten by auto-retitles.
    // A NULL watermark still means "origin unknown" for provider-indexed rows.
    //
    // App-created rows key session_id=app-id, provider_session_id=native-id, so
    // look up by provider id first; the DB upsert also refuses to overwrite their
    // name, which is why an adopted title is written through updateSessionCustomName.
    const existing = sessionsDb.getSessionByProviderSessionId(parsed.sessionId)
      ?? sessionsDb.getSessionById(parsed.sessionId);
    const currentTitle = parsed.sessionName;
    const watermark = existing?.provider_name ?? null;
    const storedName = existing?.custom_name ?? null;
    const storedNameSource = existing?.name_source ?? null;
    const isAppCreatedSession = existing !== null
      && existing.session_id !== existing.provider_session_id;
    const hasProvisionalAppName = isAppCreatedSession
      && (storedNameSource === 'provisional'
        || (storedNameSource === null
          && storedName !== null
          && storedName === parsed.provisionalSessionName));
    const providerTitleMoved = Boolean(currentTitle) && currentTitle !== watermark;
    const nameFollowsProviderTitle = storedNameSource === 'provider'
      || (storedNameSource === null
        && (!storedName || storedName === UNTITLED || storedName === watermark));
    const adoptProviderTitle = parsed.hasProviderTitle
      && Boolean(currentTitle)
      && currentTitle !== storedName
      && (hasProvisionalAppName
        || (providerTitleMoved && (parsed.titleSource === 'user' || nameFollowsProviderTitle)));

    let nameToPersist = currentTitle;
    if (storedName && storedName !== UNTITLED) {
      nameToPersist = storedName;
    }

    const timestamps = await readFileTimestamps(filePath);
    const rowSessionId = sessionsDb.createSession(
      parsed.sessionId,
      this.provider,
      parsed.projectPath,
      nameToPersist,
      timestamps.createdAt,
      timestamps.updatedAt,
      filePath,
    );

    if (parsed.hasProviderTitle && currentTitle) {
      if (adoptProviderTitle) {
        sessionsDb.updateSessionCustomName(rowSessionId, currentTitle, 'provider');
      }
      if (currentTitle !== watermark) {
        sessionsDb.updateSessionProviderName(rowSessionId, currentTitle);
      }
    }

    return rowSessionId;
  }

  /**
   * Scans until the session metadata, provider title, and first visible user
   * message have all been found. They sit near the top in practice.
   */
  private async parseSessionHeader(filePath: string): Promise<ParsedSession | null> {
    // <ts>_<id>.jsonl → the id is the last '_'-delimited segment (the ISO ts
    // uses '-', so it never contains '_'). Used only as a fallback for id.
    const idFromName = path.basename(filePath, '.jsonl').split('_').pop() || '';

    let sessionId: string | undefined;
    let projectPath: string | undefined;
    let title: string | undefined;
    let hasProviderTitle = false;
    let titleSource: string | undefined;
    let provisionalSessionName: string | undefined;

    // Keep a handle on the stream: `rl.close()` does NOT destroy its input, so the
    // early `break` below would leak the fd until GC — once per watcher tick, per
    // session file.
    const stream = fs.createReadStream(filePath);
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        let entry: Record<string, unknown> | null;
        try {
          entry = readObjectRecord(JSON.parse(trimmed));
        } catch {
          continue; // partial/malformed trailing line
        }
        if (!entry) {
          continue;
        }
        provisionalSessionName ??= readProvisionalSessionName(entry);
        if (entry.type === 'session') {
          sessionId = readOptionalString(entry.id) ?? sessionId;
          projectPath = readOptionalString(entry.cwd) ?? projectPath;
          const entryTitle = readOptionalString(entry.title);
          if (!title && entryTitle) {
            const entrySource = readOptionalString(entry.titleSource);
            hasProviderTitle = true;
            title = normalizeOmpProviderTitle(entryTitle, entrySource);
            titleSource = entrySource;
          }
        } else if (entry.type === 'title' || entry.type === 'title_change') {
          const entryTitle = readOptionalString(entry.title);
          if (entryTitle) {
            const entrySource = readOptionalString(entry.source);
            hasProviderTitle = true;
            title = normalizeOmpProviderTitle(entryTitle, entrySource);
            // `source` is omp's attribution, and it travels with the title it
            // describes: read it from the same entry, never from a later one.
            titleSource = entrySource;
          }
        }
        if (sessionId && projectPath && title && provisionalSessionName) {
          break;
        }
      }
    } finally {
      rl.close();
      stream.destroy();
    }

    const resolvedId = sessionId ?? (idFromName || undefined);
    if (!resolvedId || !projectPath) {
      return null; // without a cwd we can't attribute the session to a project
    }
    return {
      sessionId: resolvedId,
      projectPath,
      sessionName: normalizeSessionName(
        title,
        hasProviderTitle ? (provisionalSessionName ?? UNTITLED) : UNTITLED,
      ),
      hasProviderTitle,
      titleSource,
      provisionalSessionName,
    };
  }
}

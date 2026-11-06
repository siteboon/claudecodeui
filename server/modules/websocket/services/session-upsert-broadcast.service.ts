import path from 'node:path';

import { projectsDb, sessionsDb } from '@/modules/database/index.js';
import { generateDisplayName } from '@/modules/projects/index.js';
import { connectedClients, WS_OPEN_STATE } from '@/modules/websocket/services/websocket-state.service.js';
import type { SessionUpsertedEvent } from '@/shared/types.js';

/**
 * The last `session_upserted` content sent for each app session, without its
 * send time.
 *
 * The sessions watcher re-announces a session on every write to its
 * transcript, and Claude Code also writes rows that are not conversation
 * (cost and tool-usage state, titles, mode changes), e.g. when a session is
 * merely opened or closed. Clients treat every upsert as new activity: a
 * session in the background gets the "needs attention" dot, and the one being
 * viewed reloads its messages. An upsert identical to the last one sent for
 * that session therefore is not sent again.
 *
 * Content is recorded only once it has reached at least one open client, so
 * an announcement nobody received is sent again next time. Forgetting an
 * entry only costs one repeated announcement, so the map is bounded by
 * evicting the least recently announced sessions.
 */
const lastAnnouncedContent = new Map<string, string>();
const MAX_ANNOUNCED_SESSIONS = 2000;

type PendingAnnouncement = { sessionId: string; signature: string; payload: string };

/** The event serialized for sending, or null when it repeats the last one sent for its session. */
function prepareAnnouncement(event: SessionUpsertedEvent): PendingAnnouncement | null {
  const content: Partial<SessionUpsertedEvent> = { ...event };
  delete content.timestamp;
  const signature = JSON.stringify(content);
  if (lastAnnouncedContent.get(event.sessionId) === signature) {
    return null;
  }
  return { sessionId: event.sessionId, signature, payload: JSON.stringify(event) };
}

function recordAnnounced(announcements: PendingAnnouncement[]): void {
  for (const { sessionId, signature } of announcements) {
    // Re-insert, so the map's order is least recently announced first.
    lastAnnouncedContent.delete(sessionId);
    lastAnnouncedContent.set(sessionId, signature);
  }
  for (const sessionId of lastAnnouncedContent.keys()) {
    if (lastAnnouncedContent.size <= MAX_ANNOUNCED_SESSIONS) {
      break;
    }
    lastAnnouncedContent.delete(sessionId);
  }
}

/**
 * Forgets what was last announced for a session, so its next upsert is sent
 * even if nothing about it changed. Clients that loaded their list in between
 * may not have it, and a deleted session's entry would otherwise stay.
 *
 * Used by the providers module's sessions service (archive, restore, delete)
 * and session synchronizer (pruning sessions whose transcript is gone). A
 * project deleted with its sessions needs no call: a session recreated there
 * belongs to a new project row, so its announcement differs anyway.
 */
export function forgetAnnouncedSession(sessionId: string): void {
  lastAnnouncedContent.delete(sessionId);
}

/**
 * The single producer of the `session_upserted` delta.
 *
 * The event carries everything a sidebar needs to upsert a session in place
 * (its summary plus the owning project's metadata), so clients never refetch
 * the whole project list because one transcript changed on disk.
 *
 * It used to be built in two places — the on-disk sessions watcher and the
 * chat run registry — and only the registry's copy set `providerSessionId`.
 * That field is how the client notices a row it is showing has been merged
 * into its canonical app-session row, so a merge announced by any other path
 * left a stale duplicate in the sidebar. One builder, one shape.
 */
async function buildSessionUpsertedEvent(
  sessionIdOrProviderSessionId: string,
): Promise<SessionUpsertedEvent | null> {
  // Resolving by provider id first covers the watcher, which only ever sees
  // the id written in the transcript. For a row where the two ids are equal
  // — legacy rows, and any session indexed from disk before its mapping
  // existed — both lookups land on the same row anyway.
  const row = sessionsDb.getSessionByProviderSessionId(sessionIdOrProviderSessionId)
    ?? sessionsDb.getSessionById(sessionIdOrProviderSessionId);
  if (!row || row.isArchived) {
    // Forget an archived session, so un-archiving announces it again even if
    // nothing else about it changed.
    if (row) {
      forgetAnnouncedSession(row.session_id);
    }
    return null;
  }

  const projectPath = row.project_path;
  const project = projectPath ? projectsDb.getProjectPath(projectPath) : null;
  const displayName = project?.custom_project_name?.trim()
    ? project.custom_project_name
    : await generateDisplayName(path.basename(projectPath ?? '') || (projectPath ?? ''), projectPath);

  return {
    kind: 'session_upserted',
    sessionId: row.session_id,
    providerSessionId: row.provider_session_id ?? null,
    // The column is a plain TEXT and typed as `string` on the row, but only
    // provider adapters ever write it.
    provider: row.provider as SessionUpsertedEvent['provider'],
    session: {
      id: row.session_id,
      summary: row.custom_name || '',
      messageCount: 0,
      lastActivity: row.updated_at ?? row.created_at ?? new Date().toISOString(),
    },
    project: project
      ? {
        projectId: project.project_id,
        path: project.project_path,
        fullPath: project.project_path,
        displayName,
        isStarred: Boolean(project.isStarred),
      }
      : null,
    timestamp: new Date().toISOString(),
  };
}

/** Sends to every open client; true when at least one was open. */
function sendToConnectedClients(payloads: string[]): boolean {
  if (payloads.length === 0) {
    return false;
  }

  let delivered = false;
  connectedClients.forEach((client) => {
    if (client.readyState === WS_OPEN_STATE) {
      delivered = true;
      for (const payload of payloads) {
        client.send(payload);
      }
    }
  });
  return delivered;
}

function announce(announcements: PendingAnnouncement[]): void {
  if (sendToConnectedClients(announcements.map((announcement) => announcement.payload))) {
    recordAnnounced(announcements);
  }
}

/** Announces one session. Used by the chat run registry when a run reports its provider-native id. */
export async function broadcastSessionUpserted(sessionIdOrProviderSessionId: string): Promise<void> {
  const event = await buildSessionUpsertedEvent(sessionIdOrProviderSessionId);
  const announcement = event ? prepareAnnouncement(event) : null;
  if (announcement) {
    announce([announcement]);
  }
}

/**
 * Announces a batch of sessions. Used by the providers module's sessions
 * watcher, whose debounced flush can carry dozens of ids at once — the client
 * set is walked once for the whole batch rather than once per session.
 *
 * Nothing is recorded as announced until the batch is sent, so if building
 * one event throws, none of the batch is suppressed next time.
 */
export async function broadcastSessionUpsertedBatch(
  sessionIds: Iterable<string>,
): Promise<void> {
  const announcements: PendingAnnouncement[] = [];
  for (const sessionId of sessionIds) {
    const event = await buildSessionUpsertedEvent(sessionId);
    const announcement = event ? prepareAnnouncement(event) : null;
    if (announcement) {
      announcements.push(announcement);
    }
  }

  announce(announcements);
}

/** @internal Exported for the broadcast tests, which assert the payload shape directly. */
export { buildSessionUpsertedEvent };

import { getConnection } from '@/modules/database/connection.js';

/** What a finished turn cost: wall clock for the whole turn, and the part of it spent in the API. */
export type TurnDuration = {
  durationMs: number;
  durationApiMs: number | null;
};

type TurnDurationRow = {
  anchor_uuid: string;
  duration_ms: number;
  duration_api_ms: number | null;
};

/**
 * Durations of finished turns, annotating transcript rows that have no room for
 * them.
 *
 * Writes are best-effort by design: a turn whose duration fails to record still
 * renders, with an estimate taken from the timestamps either side of it. Losing
 * a number here must never cost a message, so every call swallows its error
 * rather than failing the run that produced it.
 */
export const turnDurationsDb = {
  record(providerSessionId: string, anchorUuid: string, duration: TurnDuration): void {
    if (!providerSessionId || !anchorUuid || !Number.isFinite(duration.durationMs)) {
      return;
    }

    try {
      getConnection()
        .prepare(`
          INSERT INTO turn_durations (provider_session_id, anchor_uuid, duration_ms, duration_api_ms)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (provider_session_id, anchor_uuid)
          DO UPDATE SET duration_ms = excluded.duration_ms, duration_api_ms = excluded.duration_api_ms
        `)
        .run(
          providerSessionId,
          anchorUuid,
          Math.round(duration.durationMs),
          Number.isFinite(duration.durationApiMs as number)
            ? Math.round(duration.durationApiMs as number)
            : null,
        );
    } catch (error) {
      console.error('[turn-durations] failed to record a turn duration:', error);
    }
  },

  /** Every duration recorded for one provider session, keyed by the row it belongs to. */
  listForSession(providerSessionId: string): Map<string, TurnDuration> {
    const durations = new Map<string, TurnDuration>();
    if (!providerSessionId) {
      return durations;
    }

    try {
      const rows = getConnection()
        .prepare(`
          SELECT anchor_uuid, duration_ms, duration_api_ms
          FROM turn_durations
          WHERE provider_session_id = ?
        `)
        .all(providerSessionId) as TurnDurationRow[];

      for (const row of rows) {
        durations.set(row.anchor_uuid, {
          durationMs: row.duration_ms,
          durationApiMs: row.duration_api_ms ?? null,
        });
      }
    } catch (error) {
      console.error('[turn-durations] failed to read turn durations:', error);
    }

    return durations;
  },
};

/**
 * A Claude CLI process kept alive across the turns of one conversation.
 *
 * By default every turn starts its own `query()`: a fresh CLI process that
 * rebuilds the session from disk through `resume`. That is robust - each turn
 * begins in a clean process, and a server restart costs nothing because the
 * state lives in the session file - but it pays the startup and the rebuild
 * again for every message.
 *
 * With this, the process from the first turn stays and the next message is
 * pushed into the same stdin stream. The SDK supports it: `query()` takes an
 * async iterable as its prompt, and that iterable may keep yielding.
 *
 * The catch is that the options built for the first turn - `canUseTool`, the
 * hooks - close over that turn's writer, and messages have to reach whoever
 * asked for the current one. Rather than reach through a stale socket, a turn
 * arriving on a different writer (a reconnect, another window) simply gets its
 * own process: the writer is part of what `matches()` compares.
 *
 * What cannot change is what the CLI fixed at startup: the working directory,
 * the MCP servers, the setting sources. A turn that needs different ones gets
 * a new process; `matches()` decides that. Model and permission mode do change
 * live, through the SDK's own `setModel` / `setPermissionMode`.
 */

/** Held sessions by session key. */
const heldSessions = new Map();

/** How long a session may sit idle before its process is let go. */
const DEFAULT_IDLE_MS = 10 * 60 * 1000;

export class HeldClaudeSession {
  /**
   * @param {Object} args
   * @param {string} args.sessionKey - Key this session is registered under
   * @param {Object} args.fingerprint - What the process was started with
   * @param {number} [args.idleMs] - Idle time before the process is released
   */
  constructor({ sessionKey, fingerprint, idleMs = DEFAULT_IDLE_MS }) {
    this.sessionKey = sessionKey;
    this.fingerprint = fingerprint;
    this.idleMs = idleMs;

    /** The SDK query, once started. */
    this.instance = null;
    /** Closes stdin so the CLI can exit. */
    this.release = () => {};
    /** The turn being served right now, or null between turns. */
    this.turn = null;
    /** Messages waiting to go into stdin. */
    this.queue = [];
    /** Resolves the generator's pending `await` when something is queued. */
    this.wake = null;
    this.closed = false;
    this.idleTimer = null;
    /** Set while a turn is being served, so a second one cannot cut in. */
    this.busy = false;
  }

  /**
   * Brings the live process in line with what this turn asks for.
   *
   * Only what the SDK can change mid-session: the model and the permission
   * mode. Effort has no live setter, so a change there is caught by
   * `matches()` and starts a new process instead.
   */
  async applyTurn({ model, permissionMode }) {
    if (model && model !== this.fingerprint.model) {
      await this.instance.setModel(model);
      this.fingerprint.model = model;
    }

    const mode = permissionMode || 'default';
    if (mode !== this.fingerprint.permissionMode) {
      await this.instance.setPermissionMode(mode);
      this.fingerprint.permissionMode = mode;
    }
  }

  /**
   * The prompt stream handed to `query()`.
   *
   * It never ends on its own: when the queue runs dry it waits, which keeps
   * stdin open and the process alive until `close()`.
   */
  async* promptStream() {
    while (!this.closed) {
      while (this.queue.length > 0) {
        yield this.queue.shift();
      }

      if (this.closed) {
        return;
      }

      await new Promise((resolve) => {
        this.wake = resolve;
      });
      this.wake = null;
    }
  }

  /** Queues messages for the CLI and wakes the stream if it is waiting. */
  push(messages) {
    for (const message of messages) {
      this.queue.push(message);
    }
    this.wake?.();
  }

  /**
   * Whether this process was started with what the next turn needs.
   *
   * Only what the CLI fixes at startup is compared. Model, effort and
   * permission mode are deliberately absent: the first two are handled by the
   * caller (an effort change forces a restart, the SDK has no live setter),
   * the third is set live.
   */
  matches(fingerprint) {
    return !this.closed
      && this.instance !== null
      && this.fingerprint.cwd === fingerprint.cwd
      && this.fingerprint.mcp === fingerprint.mcp
      && this.fingerprint.effort === fingerprint.effort
      // The permission callback and the hooks were built around the writer of
      // the first turn. A reconnect brings a new one, and rather than reaching
      // through the old socket, that turn gets its own process.
      && this.fingerprint.writer === fingerprint.writer;
  }

  /** Attaches the started query and begins consuming it. */
  start(instance, release) {
    this.instance = instance;
    this.release = release;
    this.consume();
  }

  /**
   * Reads the query for as long as it lives, handing every message to the turn
   * that is currently being served.
   *
   * The loop outlives the individual turn - that is the whole point - so a
   * message arriving between turns (background work reporting in) has no one to
   * go to and is dropped rather than sent to a stale socket.
   */
  async consume() {
    try {
      for await (const message of this.instance) {
        this.turn?.onMessage(message);
      }
    } catch (error) {
      this.turn?.onError(error);
    } finally {
      this.closed = true;
      heldSessions.delete(this.sessionKey);
      this.turn?.onError(new Error('The held Claude process ended.'));
      this.turn = null;
    }
  }

  /**
   * Runs one turn on this process.
   *
   * Resolves when the turn's `result` arrives; the process stays.
   *
   * @param {Object} args
   * @param {Array<Object>} args.promptMessages - What the user sent
   * @param {(message: Object) => void} args.onMessage - Receives every SDK message
   * @returns {Promise<void>}
   */
  runTurn({ promptMessages, onMessage }) {
    if (this.busy) {
      return Promise.reject(new Error('This session is already serving a turn.'));
    }
    if (this.closed || !this.instance) {
      return Promise.reject(new Error('This session is no longer held.'));
    }

    this.clearIdle();
    this.busy = true;

    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        this.busy = false;
        this.turn = null;
        this.scheduleIdle();
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      this.turn = {
        onMessage: (message) => {
          onMessage(message);
          if (message?.type === 'result') {
            finish(null);
          }
        },
        onError: finish,
      };

      this.push(promptMessages);
    });
  }

  clearIdle() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /** Lets the process go once the conversation has gone quiet. */
  scheduleIdle() {
    this.clearIdle();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.close();
    }, this.idleMs);
    // A held process must never be the reason the server cannot exit.
    this.idleTimer.unref?.();
  }

  close() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.clearIdle();
    heldSessions.delete(this.sessionKey);
    // Wakes the prompt stream so it can end, which closes stdin.
    this.wake?.();
    this.release();
  }
}

/** The session held for this key, if there is one. */
export function getHeldSession(sessionKey) {
  return sessionKey ? heldSessions.get(sessionKey) || null : null;
}

/** Registers a session under its key, replacing whatever was there. */
export function holdSession(session) {
  const previous = heldSessions.get(session.sessionKey);
  if (previous && previous !== session) {
    previous.close();
  }
  heldSessions.set(session.sessionKey, session);
}

/** Ends the held session for this key, if any. */
export function releaseHeldSession(sessionKey) {
  const session = getHeldSession(sessionKey);
  session?.close();
}

/** Ends every held session - used when the server winds down. */
export function releaseAllHeldSessions() {
  for (const session of Array.from(heldSessions.values())) {
    session.close();
  }
}

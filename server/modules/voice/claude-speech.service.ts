import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import WebSocket from 'ws';

/**
 * Dictation through Anthropic's own speech-to-text, the one Claude Code uses.
 *
 * Read out of the cli rather than guessed. It opens a websocket and streams raw
 * PCM at it:
 *
 *   L = "/api/ws/speech_to_text/voice_stream"
 *   C = VOICE_STREAM_BASE_URL || BASE_API_URL.replace("https://","wss://")
 *   E = { encoding:"linear16", sample_rate:"16000", channels:"1",
 *         endpointing_ms:"300", utterance_end_ms:"1000",
 *         language: …, use_conversation_engine:"true" }
 *   k = { Authorization:`Bearer ${accessToken}`, "x-app":"cli", … }
 *   … i.send(Buffer.from(chunk)) …            audio, as binary frames
 *   … i.send('{"type":"CloseStream"}')        to finish
 *
 * What comes back, measured against four seconds of synthesised German speech:
 *
 *   {"type": "TranscriptText", "data": "Dies ist ein Test der Spracherkennung"}
 *   {"type": "TranscriptText", "data": "Dies ist ein Test der Spracherkennung von Claude Code."}
 *   {"type": "TranscriptEndpoint"}
 *
 * `data` is the sentence being spoken, whole - each message replaces the last,
 * it is not an addition. `TranscriptInterim` carries the same thing while it is
 * still firming up.
 *
 * `TranscriptEndpoint` is NOT the end of the dictation, which is what it looked
 * like from that one short recording: with `endpointing_ms=300` in the query it
 * arrives after every pause in speech, and it means the sentence before it is
 * settled. The next one starts from empty, so the settled ones have to be kept
 * or everything said before a breath is lost.
 *
 * Two things this needs that a plain read of the stream does not show, both
 * taken from the VS Code extension, which speaks the same protocol:
 *
 *   - `{"type":"KeepAlive"}` on open and every 8 s, or the upstream closes the
 *     connection on its own.
 *   - The recording ends when the socket closes after `CloseStream`, not on an
 *     endpoint.
 *
 * This is an internal endpoint of Claude Code, not a documented API. It is
 * reached with the user's own Claude credentials and only when they ask for it.
 */

const STREAM_PATH = '/api/ws/speech_to_text/voice_stream';
/**
 * How often the upstream wants to hear that we are still here.
 *
 * Checked against the VS Code extension, which sends one `KeepAlive` the
 * moment the socket opens and then one every eight seconds. Without them the
 * upstream closes on its own, and a close with nothing transcribed is what
 * reached the user as "No speech detected".
 */
const KEEPALIVE_MS = 8_000;
const KEEPALIVE = JSON.stringify({ type: 'KeepAlive' });
/** Ceiling for audio held while connecting - about five minutes at 16 kHz mono. */
const MAX_QUEUED_BYTES = 10 * 1024 * 1024;
const DEFAULT_API_BASE = 'https://api.anthropic.com';

export type SpeechCredentials = { accessToken: string };

/** Reads the token Claude Code stores, in the order the cli looks for it. */
export async function readClaudeToken(): Promise<string | null> {
  const fromEnv = (process.env.CLAUDE_CODE_OAUTH_TOKEN || '').trim();
  if (fromEnv) {
    return fromEnv;
  }

  try {
    const file = path.join(os.homedir(), '.claude', '.credentials.json');
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as {
      claudeAiOauth?: { accessToken?: unknown; expiresAt?: unknown };
    };

    const token = parsed?.claudeAiOauth?.accessToken;
    if (typeof token !== 'string' || !token.trim()) {
      return null;
    }

    // An expired token is refused upstream anyway; saying so here is clearer
    // than a websocket that closes without explanation.
    const expiresAt = parsed.claudeAiOauth?.expiresAt;
    if (typeof expiresAt === 'number' && Date.now() >= expiresAt) {
      return null;
    }

    return token;
  } catch {
    return null;
  }
}

export type SpeechEvents = {
  /** The transcript so far - replaces whatever came before. */
  onTranscript: (text: string) => void;
  onEnd: () => void;
  onError: (message: string) => void;
};

export class ClaudeSpeechStream {
  private upstream: WebSocket | null = null;

  private closing = false;

  /**
   * Audio that arrived before the upstream socket finished opening.
   *
   * Connecting takes a moment, and the microphone does not wait: dropping those
   * first chunks costs the first words. Measured with four seconds of speech
   * sent immediately, "Dies ist ein Test …" came back as "ein Test …".
   */
  private queued: Buffer[] = [];

  /**
   * How much audio is held, in bytes. Counting chunks says nothing about size -
   * the page decides how big a frame is, and 300 large ones would be hundreds
   * of megabytes in this process.
   */
  private queuedBytes = 0;

  /** A `stop` that arrived while the stream was still opening. */
  private finishQueued = false;

  /**
   * Whether the end has already been reported.
   *
   * It is announced twice: `TranscriptEndpoint` arrives, and the upstream
   * closes right after. Measured against a spoken sentence, 28 ms apart -
   * close enough to reach the page in one turn, which would have inserted the
   * transcript twice, or sent it twice when the button was held.
   */
  private ended = false;

  /**
   * Whether the upstream ever said anything about this recording.
   *
   * A socket that closes after a transcript, or after `TranscriptEndpoint`,
   * ended normally. One that closes before either did not: the recording was
   * cut off - a refused token, a protocol error, a dropped line - and
   * reporting that as a finished dictation puts "No speech detected" in front
   * of the user, which is a different problem with a different fix.
   */
  private heardUpstream = false;

  /** Keeps the upstream from closing the connection under us. */
  private keepAlive: NodeJS.Timeout | null = null;

  /**
   * Sentences the upstream has finished with.
   *
   * `TranscriptEndpoint` does not mean the dictation is over - it means one
   * sentence is settled, and with `endpointing_ms=300` it arrives after every
   * short pause in speech. Treating it as the end cut the recording off at the
   * first breath. What it actually marks is the point where the text so far
   * stops changing, so it moves here and the next sentence starts fresh.
   */
  private committed = '';

  /** The sentence being transcribed right now; every message replaces it. */
  private pending = '';

  constructor(private readonly events: SpeechEvents) {}

  /** Everything settled so far, plus the sentence still being spoken. */
  private wholeTranscript(): string {
    if (!this.committed) {
      return this.pending;
    }
    return this.pending ? `${this.committed} ${this.pending}` : this.committed;
  }

  /** Moves the sentence in progress into the settled text and reports it. */
  private settlePending(): void {
    if (!this.pending) {
      return;
    }

    this.committed = this.wholeTranscript();
    this.pending = '';
    this.events.onTranscript(this.committed);
  }

  /** The end is reported once, whichever of the two says so first. */
  private emitEnd(): void {
    if (this.ended) {
      return;
    }

    this.ended = true;
    this.events.onEnd();
  }

  async open(language: string): Promise<void> {
    const token = await readClaudeToken();
    if (!token) {
      // Nothing will come of this stream, so it must not go on collecting the
      // audio the page keeps sending until someone closes it.
      this.closing = true;
      this.events.onError('No Claude credentials. Run "claude /login" once.');
      return;
    }

    const base = (process.env.VOICE_STREAM_BASE_URL || DEFAULT_API_BASE)
      .replace(/^https:\/\//, 'wss://')
      .replace(/^http:\/\//, 'ws://')
      .replace(/\/$/, '');

    // The credentials travel in an Authorization header. Plain ws:// is only
    // allowed to reach this machine - a stand-in during development - never a
    // host on the network, where the token would go across in the clear.
    if (base.startsWith('ws://') && !/^ws:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$|\/)/.test(base)) {
      this.closing = true;
      this.events.onError('VOICE_STREAM_BASE_URL must use https for anything but localhost.');
      return;
    }

    const params = new URLSearchParams({
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
      endpointing_ms: '300',
      utterance_end_ms: '1000',
      language: language || 'en',
      use_conversation_engine: 'true',
    });

    const socket = new WebSocket(`${base}${STREAM_PATH}?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-app': 'cli',
        'anthropic-client-platform': 'cli',
      },
    });

    socket.on('open', () => {
      // Whatever the microphone produced while connecting goes first, in
      // order, before anything new.
      for (const chunk of this.queued) {
        socket.send(chunk);
      }
      this.queued = [];
      this.queuedBytes = 0;

      // One straight away, then on the clock - the upstream closes a stream it
      // has not heard from.
      socket.send(KEEPALIVE);
      this.keepAlive = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(KEEPALIVE);
        }
      }, KEEPALIVE_MS);
      this.keepAlive.unref?.();

      if (this.finishQueued) {
        this.finishQueued = false;
        socket.send('{"type":"CloseStream"}');
      }
    });
    socket.on('message', (raw: Buffer) => this.handleMessage(raw.toString()));
    socket.on('error', (error: Error) => this.events.onError(error.message));
    socket.on('close', (code: number, reason: Buffer) => {
      this.upstream = null;
      this.stopKeepAlive();

      // Whatever was still being spoken when the line went down is the last
      // thing the user said - it belongs in the transcript, not dropped.
      this.settlePending();

      if (this.closing) {
        return;
      }

      if (this.heardUpstream) {
        this.emitEnd();
        return;
      }

      // Closed without ever transcribing anything. Saying "the dictation
      // ended" here is what turned every one of these into "No speech
      // detected" - the close code is the only thing that says what really
      // happened, so it goes to the user.
      const detail = reason?.toString().trim();
      this.events.onError(
        `The dictation service closed the connection (${code}${detail ? `: ${detail}` : ''}).`,
      );
      this.ended = true;
    });

    this.upstream = socket;
  }

  private handleMessage(text: string): void {
    try {
      const message = JSON.parse(text) as { type?: string; data?: unknown };
      // Interim and final text arrive under two names and mean the same thing
      // here: the sentence in progress, whole, replacing what came before.
      if (
        (message.type === 'TranscriptText' || message.type === 'TranscriptInterim')
        && typeof message.data === 'string'
      ) {
        this.heardUpstream = true;
        this.pending = message.data;
        this.events.onTranscript(this.wholeTranscript());
        return;
      }

      if (message.type === 'TranscriptEndpoint') {
        this.heardUpstream = true;
        this.settlePending();
        return;
      }

      // The upstream's own failures, which used to fall through to the
      // catch-all below and vanish.
      if (message.type === 'TranscriptError' || message.type === 'error') {
        const detail = typeof message.data === 'string'
          ? message.data
          : (message as { description?: string; message?: string }).description
            ?? (message as { message?: string }).message;
        this.events.onError(detail || 'The dictation service reported an error.');
      }
    } catch {
      // Anything that is not json is not ours to interpret.
    }
  }

  /** One chunk of 16 kHz mono PCM16, exactly as the cli sends it. */
  send(chunk: Buffer): void {
    if (this.upstream?.readyState === WebSocket.OPEN) {
      this.upstream.send(chunk);
      return;
    }

    // Still connecting - hold it rather than lose the opening words. Capped in
    // bytes so an upstream that never opens cannot grow without end; 10 MB is
    // around five minutes of the 16 kHz mono the stream takes.
    if (!this.closing && this.queuedBytes + chunk.length <= MAX_QUEUED_BYTES) {
      this.queued.push(chunk);
      this.queuedBytes += chunk.length;
    }
  }

  /** Asks for the final transcript and lets the stream finish. */
  finish(): void {
    if (this.upstream?.readyState === WebSocket.OPEN) {
      this.upstream.send('{"type":"CloseStream"}');
      return;
    }

    // Spoken and released before the stream was up: finish once it is.
    this.finishQueued = true;
  }

  close(): void {
    this.closing = true;
    this.stopKeepAlive();
    this.queued = [];
    this.queuedBytes = 0;
    this.upstream?.close();
    this.upstream = null;
  }

  /** A timer that outlives its socket would keep sending into nothing. */
  private stopKeepAlive(): void {
    if (this.keepAlive) {
      clearInterval(this.keepAlive);
      this.keepAlive = null;
    }
  }
}

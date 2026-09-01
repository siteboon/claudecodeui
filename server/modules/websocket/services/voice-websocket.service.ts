import type { WebSocket } from 'ws';

import { ClaudeSpeechStream } from '@/modules/voice/index.js';

/**
 * Bridges the browser to Anthropic's speech-to-text.
 *
 * The browser cannot open that stream itself: it needs the Claude credentials,
 * which live on this machine and have no business in a page. So the page sends
 * PCM here and gets transcripts back.
 *
 * From the page:
 *   {"type":"start","language":"de"}   opens the upstream stream
 *   binary frames                      16 kHz mono PCM16, as-is
 *   {"type":"stop"}                    asks for the final transcript
 *
 * To the page:
 *   {"type":"transcript","text":"…"}   the whole transcript so far
 *   {"type":"end"}                     upstream is done
 *   {"type":"error","message":"…"}
 */
export function handleVoiceWebSocket(ws: WebSocket): void {
  let stream: ClaudeSpeechStream | null = null;

  const say = (payload: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  };

  const startStream = async (language: string) => {
    if (stream) {
      return;
    }

    stream = new ClaudeSpeechStream({
      onTranscript: (text) => say({ type: 'transcript', text }),
      onEnd: () => say({ type: 'end' }),
      onError: (message) => say({ type: 'error', message }),
    });

    await stream.open(language);
  };

  ws.on('message', (raw: Buffer, isBinary: boolean) => {
    // Audio arrives as binary frames and goes straight through; only control
    // messages are json.
    if (isBinary) {
      stream?.send(raw);
      return;
    }

    try {
      const message = JSON.parse(raw.toString()) as { type?: string; language?: unknown };
      if (message.type === 'start') {
        const language = typeof message.language === 'string' ? message.language : 'en';
        // A stream that cannot even be opened has to say so; unhandled, the
        // page would wait for a transcript that is never coming.
        void startStream(language).catch((error: unknown) => {
          say({ type: 'error', message: error instanceof Error ? error.message : String(error) });
        });
        return;
      }
      if (message.type === 'stop') {
        stream?.finish();
      }
    } catch {
      // Not json: nothing to act on.
    }
  });

  ws.on('close', () => {
    stream?.close();
    stream = null;
  });

  ws.on('error', () => {
    stream?.close();
    stream = null;
  });
}

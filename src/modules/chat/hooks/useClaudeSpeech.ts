import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Dictation through Anthropic's speech-to-text, over CloudCLI's own bridge.
 *
 * The stream wants exactly what Claude Code sends it: 16 kHz mono PCM16, raw.
 * `MediaRecorder` cannot produce that - it hands out webm/opus - so the audio
 * is taken from an `AudioContext` running at 16 kHz and converted sample by
 * sample. The conversion runs in an AudioWorklet, off the main thread, so a
 * busy interface cannot drop audio.
 *
 * The credentials stay on the server; the page only ever sees PCM going out and
 * transcripts coming back. Protocol on `/voice-stream`:
 *
 *   → {"type":"start","language":"de"}
 *   → binary frames of PCM16
 *   → {"type":"stop"}
 *   ← {"type":"transcript","text":"…"}    the whole transcript so far
 *   ← {"type":"end"} | {"type":"error","message":"…"}
 */

export type ClaudeSpeechState = 'idle' | 'recording' | 'transcribing';

/** Claude Code's own rate for this stream; the service takes nothing else. */
const SAMPLE_RATE = 16000;

/**
 * Collects 100 ms of audio and passes it on as Int16 - the chunk size the cli
 * uses as well.
 */
const WORKLET_SOURCE = `
class PcmChunker extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(1600);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) {
      return true;
    }

    for (let i = 0; i < channel.length; i += 1) {
      // Float -1..1 to signed 16-bit, clamped so a loud passage cannot wrap.
      const sample = Math.max(-1, Math.min(1, channel[i]));
      this.buffer[this.filled] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      this.filled += 1;

      if (this.filled === this.buffer.length) {
        this.port.postMessage(this.buffer.slice().buffer, [this.buffer.slice().buffer]);
        this.filled = 0;
      }
    }

    return true;
  }
}

registerProcessor('pcm-chunker', PcmChunker);
`;

function socketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = localStorage.getItem('auth-token') || '';
  return `${protocol}//${window.location.host}/voice-stream?token=${encodeURIComponent(token)}`;
}

export function useClaudeSpeech(
  onTranscript: (text: string, send?: boolean, final?: boolean) => void,
  onError?: (message: string) => void,
) {
  const [state, setState] = useState<ClaudeSpeechState>('idle');

  const socket = useRef<WebSocket | null>(null);
  const context = useRef<AudioContext | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const transcript = useRef('');
  const sendOnEnd = useRef(false);
  const workletUrl = useRef<string | null>(null);
  /** Set once this dictation is over, so a late message cannot repeat it. */
  const finished = useRef(false);
  /**
   * Set while the microphone and the socket are being set up.
   *
   * `socket.current` only exists after `getUserMedia` has been awaited, so
   * checking that alone lets a second press through in between - and that one
   * opens its own microphone and its own connection, with nothing to stop
   * either.
   */
  const starting = useRef(false);

  const cleanup = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    void context.current?.close().catch(() => {});
    context.current = null;
    if (workletUrl.current) {
      URL.revokeObjectURL(workletUrl.current);
      workletUrl.current = null;
    }
  }, []);

  // Leaving mid-recording must not keep the microphone or the socket open.
  useEffect(() => () => {
    cleanup();
    socket.current?.close();
    socket.current = null;
  }, [cleanup]);

  const start = useCallback(async () => {
    if (socket.current || starting.current) {
      return;
    }

    starting.current = true;
    transcript.current = '';
    sendOnEnd.current = false;
    finished.current = false;

    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      stream.current = media;

      // Asking for 16 kHz here is what saves resampling later; browsers honour
      // it by resampling the device themselves.
      const audio = new AudioContext({ sampleRate: SAMPLE_RATE });
      context.current = audio;
      // A context can come up suspended - autoplay rules, or a window that
      // has not been clicked. Suspended, the worklet never runs and not one
      // sample is captured.
      if (audio.state === 'suspended') {
        await audio.resume();
      }

      const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
      workletUrl.current = URL.createObjectURL(blob);
      await audio.audioWorklet.addModule(workletUrl.current);

      const ws = new WebSocket(socketUrl());
      ws.binaryType = 'arraybuffer';
      socket.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'start',
          language: (document.documentElement.lang || navigator.language || 'en').slice(0, 2),
        }));
      };

      ws.onmessage = (event) => {
        // Everything after the first end belongs to a dictation that is over:
        // the transcript has been handed on, and handing it on again would put
        // it in the box twice.
        if (finished.current) {
          return;
        }

        let message: { type?: string; text?: string; message?: string };
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }

        if (message.type === 'transcript' && typeof message.text === 'string') {
          // Each message is the full transcript, not an addition - and it goes
          // straight into the box, the way the VS Code extension does it.
          // Holding it back until the end is what made dictation look like it
          // had stopped working: nothing on screen while speaking, then all of
          // it at once, if the end arrived at all.
          transcript.current = message.text;
          onTranscript(message.text, false, false);
          return;
        }
        if (message.type === 'error') {
          // Nothing more is coming, so the microphone and the button have to be
          // let go here - otherwise the button keeps spinning with no end in
          // sight, which is what a missing login used to look like.
          finished.current = true;
          cleanup();
          socket.current?.close();
          socket.current = null;
          setState('idle');
          onError?.(message.message || 'Dictation failed.');
          return;
        }
        if (message.type === 'end') {
          finished.current = true;
          const text = transcript.current.trim();
          if (text) {
            onTranscript(text, sendOnEnd.current, true);
          } else {
            onError?.('No speech detected');
          }

          socket.current?.close();
          socket.current = null;
          setState('idle');
        }
      };

      ws.onerror = () => {
        if (socket.current !== ws) {
          return;
        }
        onError?.('The dictation connection failed.');
      };
      ws.onclose = () => {
        // Only this dictation's own socket may act here. A close arrives after
        // the fact, and stopping and starting again straight away puts a new
        // recording in place first - the old socket would then shut off the new
        // microphone and drop its connection.
        if (socket.current !== ws) {
          return;
        }

        // A connection that drops mid-recording would otherwise leave the
        // microphone running with nothing listening to it.
        cleanup();
        socket.current = null;
        setState((current) => (current === 'idle' ? current : 'idle'));
      };

      const source = audio.createMediaStreamSource(media);
      const chunker = new AudioWorkletNode(audio, 'pcm-chunker');
      chunker.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        // The server holds anything that arrives before the upstream is open,
        // so there is nothing to wait for here.
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(event.data);
        }
      };

      source.connect(chunker);
      // Without a destination the graph is not pulled; a zero gain keeps it
      // silent so nobody hears themselves.
      const silence = audio.createGain();
      silence.gain.value = 0;
      chunker.connect(silence).connect(audio.destination);

      starting.current = false;
      setState('recording');
    } catch (error) {
      starting.current = false;
      cleanup();
      socket.current?.close();
      socket.current = null;
      setState('idle');

      const failure = error as { name?: string; message?: string };
      if (failure?.name === 'NotAllowedError') {
        onError?.('Microphone access denied.');
      } else if (failure?.name === 'NotFoundError') {
        onError?.('No microphone found.');
      } else {
        onError?.(`Dictation failed: ${failure?.message || String(error)}`);
      }
    }
  }, [cleanup, onError, onTranscript]);

  const stop = useCallback((options?: { send?: boolean }) => {
    if (!socket.current) {
      return;
    }

    sendOnEnd.current = options?.send ?? false;
    // The microphone can go now; the last words are already on their way and
    // the final transcript arrives with `end`.
    cleanup();
    setState('transcribing');

    if (socket.current.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({ type: 'stop' }));
    }
  }, [cleanup]);

  const toggle = useCallback(() => {
    if (state === 'recording') {
      stop();
    } else if (state === 'idle') {
      void start();
    }
  }, [state, start, stop]);

  return { state, start, stop, toggle };
}

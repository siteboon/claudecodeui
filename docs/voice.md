# Voice (optional)

Adds two opt-in voice features to the chat:

- **Push-to-talk dictation** — a mic button in the composer records your voice, transcribes it
  (speech-to-text), and drops the text into the input.
- **Read-aloud** — a speaker button on each assistant message plays it back (text-to-speech).

Voice is **disabled by default**. The UI only appears when a voice backend is configured, so it has
zero impact on installs that don't use it.

## Enable it

Set `VOICE_SIDECAR_URL` for the server to point at a voice backend, then restart:

```bash
VOICE_SIDECAR_URL=http://127.0.0.1:8765 npm run server
```

When set, `GET /api/voice/health` reports `{ "enabled": true }` and the mic + speaker controls appear.
All voice requests are proxied through the app's authenticated `/api/voice/*` routes, so the backend
itself only needs to listen on localhost and is never exposed directly.

## Backend contract

`VOICE_SIDECAR_URL` can point at **any** service that implements two endpoints:

| Method & path | Request | Response |
|---|---|---|
| `POST /transcribe` | multipart, field `audio` (webm/mp4/wav/…) | `{ "text": "..." }` |
| `POST /tts` | form field `text` | audio bytes (`audio/*`, e.g. wav/mp3) |

This keeps the feature provider-agnostic — you can back it with the bundled local sidecar, or a cloud
transcription + TTS gateway, as long as it speaks that contract.

## Reference backend: `voice-sidecar/`

A local, no-API-key reference implementation using **faster-whisper** (STT) and **Kokoro-82M** (TTS),
both CPU-capable.

```bash
cd voice-sidecar
python -m venv .venv && . .venv/bin/activate    # (Windows: .venv\Scripts\activate)
pip install -r requirements.txt
python -m uvicorn app:app --host 127.0.0.1 --port 8765
```

Then run the app with `VOICE_SIDECAR_URL=http://127.0.0.1:8765`.

Config (env, all optional) — see `voice-sidecar/.env.example`: `WHISPER_MODEL_SIZE`, `WHISPER_DEVICE`
(`cpu`/`cuda`), `KOKORO_VOICE`, `VOICE_PORT`.

## Notes

- The first read-aloud is slow (~10–20s) while the model lazy-loads; it's near-instant and cached after.
- Recording needs a secure context (HTTPS or localhost) for microphone access.
- On iOS, playback is tap-initiated (manual read-aloud) to satisfy Safari's autoplay policy.

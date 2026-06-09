# Voice (optional)

Two opt-in voice features in the chat:

- **Push-to-talk dictation** — a mic button in the composer records, transcribes, and fills the input.
- **Read-aloud** — a speaker button on each assistant message plays it back.

Voice is **off by default**. Turn it on with the **Voice** toggle in Quick Settings or in
**Settings → Voice**. When off, the mic and speaker controls are hidden.

## Backend

Voice uses any **OpenAI-compatible audio backend**, configured in **Settings → Voice**:

| Field | Example | Notes |
|---|---|---|
| Base URL | `https://api.openai.com/v1` | OpenAI, Groq, or a local server |
| API key | `sk-…` | sent only to this app's backend, which proxies the request |
| Speech-to-text model | `whisper-1`, `gpt-4o-transcribe`, `whisper-large-v3-turbo` | |
| Text-to-speech model | `tts-1`, `gpt-4o-mini-tts`, `kokoro` | |
| Voice | `alloy`, `af_heart`, … | depends on the backend |

The backend must expose the standard endpoints:

```
POST {baseUrl}/audio/transcriptions   (multipart 'file' + 'model')   -> { "text": "..." }
POST {baseUrl}/audio/speech           ({ model, voice, input })       -> audio bytes
```

That covers OpenAI and Groq, plus local servers like **LocalAI**, **Speaches**, **Kokoro-FastAPI**,
and **openedai-speech**. Requests are proxied through the app's authenticated `/api/voice/*` routes,
so a local backend only needs to listen on localhost.

### Server-side defaults (optional)

Instead of (or as defaults behind) the Settings fields, you can set env vars on the server:

```
VOICE_API_BASE_URL=http://127.0.0.1:8765/v1
VOICE_API_KEY=...
VOICE_STT_MODEL=whisper-1
VOICE_TTS_MODEL=tts-1
VOICE_TTS_VOICE=alloy
```

Per-user Settings values override these. If neither is set, the voice routes return 503.

## Notes

- Recording needs a secure context (HTTPS or localhost) for microphone access.
- On iOS, read-aloud is tap-initiated to satisfy Safari's autoplay policy.

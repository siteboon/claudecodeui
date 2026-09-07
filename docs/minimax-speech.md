# MiniMax read-aloud

Enable Voice in Settings and enter `https://api.minimax.io/v1` as the base URL for the
global service, or `https://api.minimaxi.com/v1` for the China service. Enter your MiniMax API
key. The full regional `t2a_v2` URL is also accepted.

Leave the text-to-speech model blank to use `speech-2.8-hd` and the voice
blank to use `English_expressive_narrator`, or supply your model and voice ID.
Audio format defaults to MP3; WAV, FLAC, and PCM are also accepted. Browser playback
depends on support for the selected format; MP3 is recommended for read-aloud.

For server-managed credentials, leave the browser base URL blank and configure
`VOICE_API_BASE_URL` and `VOICE_API_KEY` on the server. Optional `VOICE_TTS_MODEL`
and `VOICE_TTS_VOICE` values override the same defaults.

This integration supports synchronous speech synthesis. Speech transcription
requires a backend with a transcription API.

API reference: https://platform.minimax.io/docs/api-reference/speech-t2a-http

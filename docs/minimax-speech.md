# MiniMax read-aloud

Enable Voice in Settings and enter `https://api.minimax.io/v1` as the base URL for the
global service, or `https://api.minimaxi.com/v1` for the China service. Enter your MiniMax API
key. The full regional `t2a_v2` URL is also accepted.

Leave the text-to-speech model blank to use `speech-2.8-hd` and the voice
blank to use `English_expressive_narrator`, or supply one of the current speech
models: `speech-2.8-hd`, `speech-2.8-turbo`, `speech-2.6-hd`, `speech-2.6-turbo`,
`speech-02-hd`, `speech-02-turbo`, `speech-01-hd`, or `speech-01-turbo`.
Audio format defaults to MP3; WAV, FLAC, and PCM are also accepted. Browser playback
depends on support for the selected format; MP3 is recommended for read-aloud.

The synchronous request contains the required `model` and `text` fields. The adapter
sets `stream: false`, requests hex audio, and maps the configured voice and audio format
to `voice_setting` and `audio_setting`; MiniMax's other optional controls (`language_boost`,
`pronunciation_dict`, `voice_modify`, and `subtitle_enable`) remain at their API defaults.
Successful responses require `base_resp.status_code: 0` and `data.status: 2`; the hex
payload in `data.audio` is decoded to the selected audio format.

For server-managed credentials, leave the browser base URL blank and configure
`VOICE_API_BASE_URL` and `VOICE_API_KEY` on the server. Optional `VOICE_TTS_MODEL`
and `VOICE_TTS_VOICE` values override the same defaults.

This integration supports synchronous speech synthesis. Speech transcription
requires a backend with a transcription API.

API reference: https://platform.minimax.io/docs/api-reference/speech-t2a-http

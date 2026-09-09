const MINIMAX_SPEECH_ENDPOINTS = [
  'https://api.minimax.io/v1/t2a_v2',
  'https://api.minimaxi.com/v1/t2a_v2',
];
const MINIMAX_SPEECH_MODELS = [
  'speech-2.8-hd',
  'speech-2.8-turbo',
  'speech-2.6-hd',
  'speech-2.6-turbo',
  'speech-02-hd',
  'speech-02-turbo',
  'speech-01-hd',
  'speech-01-turbo',
] as const;
const MINIMAX_SPEECH_MODEL = MINIMAX_SPEECH_MODELS[0];
const MINIMAX_AUDIO_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  pcm: 'audio/pcm',
};

type MiniMaxSpeechSettings = {
  apiKey: string;
  ttsModel: string;
  ttsVoice: string;
  ttsFormat: string;
};

/** Used by the browser voice API and server Voice module to select a regional TTS endpoint. */
export function getMiniMaxSpeechEndpoint(baseUrl: string): string | undefined {
  const normalizedUrl = baseUrl.trim().replace(/\/+$/, '');
  return MINIMAX_SPEECH_ENDPOINTS.find((endpoint) =>
    normalizedUrl === endpoint || normalizedUrl === endpoint.slice(0, endpoint.lastIndexOf('/')),
  );
}

function speechFailure(error: string, status = 502): Response {
  return Response.json({ error }, { status });
}

/**
 * Used by the browser voice API and server Voice service to turn MiniMax's
 * synchronous JSON/hex response into playable audio without a second download.
 * The caller supplies the fetch adapter, including its timeout or abort signal.
 */
export async function synthesizeMiniMaxSpeech(
  endpoint: string,
  text: string,
  settings: MiniMaxSpeechSettings,
  fetchBackend: (url: string, options: RequestInit) => Promise<Response>,
  signal?: AbortSignal,
): Promise<Response> {
  const format = settings.ttsFormat.trim() || 'mp3';
  if (!Object.prototype.hasOwnProperty.call(MINIMAX_AUDIO_TYPES, format)) {
    return speechFailure('Unsupported MiniMax audio format. Use mp3, wav, flac, or pcm.', 400);
  }

  const response = await fetchBackend(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: settings.ttsModel.trim() || MINIMAX_SPEECH_MODEL,
      text,
      stream: false,
      output_format: 'hex',
      voice_setting: { voice_id: settings.ttsVoice.trim() || 'English_expressive_narrator' },
      audio_setting: { format },
    }),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    return response;
  }

  let payload: {
    base_resp?: { status_code?: number };
    data?: { audio?: unknown; status?: number };
  } | null;
  try {
    payload = await response.json() as typeof payload;
  } catch {
    return speechFailure('MiniMax returned an invalid speech response.');
  }
  if (!payload || payload.base_resp?.status_code !== 0) {
    const code = payload?.base_resp?.status_code;
    return speechFailure(
      typeof code !== 'number' ? 'MiniMax returned an invalid speech response.' : `MiniMax speech failed (code ${code}).`,
    );
  }

  const audio = payload.data?.audio;
  if (payload.data?.status !== 2 || typeof audio !== 'string' || !/^(?:[\da-f]{2})+$/i.test(audio)) {
    return speechFailure('MiniMax returned incomplete or invalid speech audio.');
  }

  const bytes = new Uint8Array(audio.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(audio.slice(index * 2, index * 2 + 2), 16);
  }
  return new Response(bytes, { headers: { 'Content-Type': MINIMAX_AUDIO_TYPES[format] } });
}

// Optional voice proxy — forwards STT/TTS to an OpenAI-compatible audio backend.
//
// The backend is whatever the user points at: OpenAI, Groq, or a local server
// (LocalAI / Speaches / Kokoro-FastAPI / openedai-speech / etc.). It must expose the
// standard OpenAI audio endpoints:
//     POST {base}/audio/transcriptions   (multipart 'file' + 'model')      -> { text }
//     POST {base}/audio/speech           ({ model, voice, input })         -> audio bytes
//
// Config is resolved per-request from headers (set by the client's voice settings),
// falling back to server env defaults. Mounted at /api/voice behind authenticateToken.
import express from 'express';

const ENV = {
  baseUrl: (process.env.VOICE_API_BASE_URL || '').replace(/\/$/, ''),
  apiKey: process.env.VOICE_API_KEY || '',
  sttModel: process.env.VOICE_STT_MODEL || 'whisper-1',
  ttsModel: process.env.VOICE_TTS_MODEL || 'tts-1',
  ttsVoice: process.env.VOICE_TTS_VOICE || 'alloy',
  ttsFormat: process.env.VOICE_TTS_FORMAT || 'mp3',
};

// Per-request config: client headers (from the user's voice settings) override env defaults.
function resolveConfig(req) {
  const h = req.headers;
  return {
    baseUrl: (String(h['x-voice-base-url'] || '') || ENV.baseUrl).replace(/\/$/, ''),
    apiKey: String(h['x-voice-api-key'] || '') || ENV.apiKey,
    sttModel: String(h['x-voice-stt-model'] || '') || ENV.sttModel,
    ttsModel: String(h['x-voice-tts-model'] || '') || ENV.ttsModel,
    ttsVoice: String(h['x-voice-tts-voice'] || '') || ENV.ttsVoice,
  };
}

const router = express.Router();

const VOICE_TIMEOUT_MS = Number(process.env.VOICE_TIMEOUT_MS || 60000);
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VOICE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

let _upload = null;
async function getUpload() {
  if (!_upload) {
    const multer = (await import('multer')).default;
    _upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
  }
  return _upload;
}

function authHeader(apiKey) {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

// GET /api/voice/health -> { configured } (true if a base URL is available)
router.get('/health', (req, res) => {
  res.json({ configured: Boolean(resolveConfig(req).baseUrl) });
});

// POST /api/voice/transcribe  (multipart 'audio') -> { text }
router.post('/transcribe', async (req, res) => {
  const cfg = resolveConfig(req);
  if (!cfg.baseUrl) return res.status(503).json({ error: 'No voice backend configured' });
  const upload = await getUpload();
  upload.single('audio')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No audio uploaded' });
    try {
      const fd = new FormData();
      fd.append(
        'file',
        new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' }),
        req.file.originalname || 'recording.webm',
      );
      fd.append('model', cfg.sttModel);
      const r = await fetchWithTimeout(`${cfg.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: authHeader(cfg.apiKey),
        body: fd,
      });
      const text = await r.text();
      if (!r.ok) return res.status(r.status).json({ error: text || 'transcription failed' });
      let data;
      try { data = JSON.parse(text); } catch { data = { text }; }
      res.json({ text: data.text ?? '' });
    } catch (e) {
      res.status(502).json({ error: `voice backend unreachable: ${e.message}` });
    }
  });
});

// POST /api/voice/tts  { text } -> audio bytes
router.post('/tts', async (req, res) => {
  const cfg = resolveConfig(req);
  if (!cfg.baseUrl) return res.status(503).json({ error: 'No voice backend configured' });
  const text = req.body?.text;
  if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });
  try {
    const r = await fetchWithTimeout(`${cfg.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(cfg.apiKey) },
      body: JSON.stringify({
        model: cfg.ttsModel,
        voice: cfg.ttsVoice,
        input: text,
        response_format: ENV.ttsFormat,
      }),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => 'tts failed');
      return res.status(r.status).json({ error: errText });
    }
    res.setHeader('Content-Type', r.headers.get('content-type') || 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.status(502).json({ error: `voice backend unreachable: ${e.message}` });
  }
});

export default router;

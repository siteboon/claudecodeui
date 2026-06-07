// Optional voice proxy — forwards speech-to-text / text-to-speech to a configurable backend.
//
// Opt-in: voice is DISABLED unless VOICE_SIDECAR_URL is set. When set, it must point at a
// backend (any implementation) exposing:
//     POST /transcribe   (multipart field 'audio')  -> { text }
//     POST /tts          (form field 'text')        -> audio bytes (audio/*)
// A reference backend (local faster-whisper + Kokoro) ships in /voice-sidecar, but any
// service implementing the two endpoints works (e.g. a cloud transcription + TTS gateway).
//
// Mounted at /api/voice behind authenticateToken, so it inherits the app's auth. The backend
// should bind to localhost and is never exposed directly.
import express from 'express';

const VOICE_SIDECAR_URL = (process.env.VOICE_SIDECAR_URL || '').replace(/\/$/, '');
const VOICE_ENABLED = Boolean(VOICE_SIDECAR_URL);

const router = express.Router();

// Lazy multer (memory storage) for the audio upload — matches index.js's pattern.
let _upload = null;
async function getUpload() {
  if (!_upload) {
    const multer = (await import('multer')).default;
    _upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 }, // 25MB — short dictation clips
    });
  }
  return _upload;
}

function ensureEnabled(res) {
  if (!VOICE_ENABLED) {
    res.status(503).json({ error: 'Voice is not configured. Set VOICE_SIDECAR_URL to enable it.' });
    return false;
  }
  return true;
}

// GET /api/voice/health -> { enabled }  (frontend hides the voice UI when disabled)
router.get('/health', (_req, res) => res.json({ enabled: VOICE_ENABLED }));

// POST /api/voice/transcribe  (multipart 'audio') -> { text }
router.post('/transcribe', async (req, res) => {
  if (!ensureEnabled(res)) return;
  const upload = await getUpload();
  upload.single('audio')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No audio uploaded' });
    try {
      const fd = new FormData();
      fd.append(
        'audio',
        new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' }),
        req.file.originalname || 'recording.webm',
      );
      const r = await fetch(`${VOICE_SIDECAR_URL}/transcribe`, { method: 'POST', body: fd });
      const data = await r.json().catch(() => ({ error: 'bad voice backend response' }));
      res.status(r.status).json(data);
    } catch (e) {
      res.status(502).json({ error: `voice backend unreachable: ${e.message}` });
    }
  });
});

// POST /api/voice/tts  { text } -> audio bytes
router.post('/tts', async (req, res) => {
  if (!ensureEnabled(res)) return;
  const text = req.body?.text;
  if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });
  try {
    const fd = new FormData();
    fd.append('text', text);
    const r = await fetch(`${VOICE_SIDECAR_URL}/tts`, { method: 'POST', body: fd });
    if (!r.ok) {
      const errText = await r.text().catch(() => 'tts failed');
      return res.status(r.status).json({ error: errText });
    }
    res.setHeader('Content-Type', r.headers.get('content-type') || 'audio/wav');
    res.setHeader('Cache-Control', 'no-store');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.status(502).json({ error: `voice backend unreachable: ${e.message}` });
  }
});

export default router;

"""
CloudCLI voice sidecar — local STT (faster-whisper) + local TTS (Kokoro-82M).

Ported from the tooler voice endpoints (D:\\tooler\\backend\\server.py), swapping
edge-tts -> Kokoro. Bound to 127.0.0.1 only; CloudCLI's Express server proxies to
it behind JWT auth. Never exposed to the tailnet directly.

Endpoints:
  GET  /health           -> {status, whisper_loaded, kokoro_loaded}
  POST /transcribe       (multipart 'audio')        -> {text, duration_ms}
  POST /tts              (form 'text')              -> audio/wav bytes (cached)
"""
import asyncio
import hashlib
import logging
import os
import re
import tempfile
import time
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("voice-sidecar")

# ---- Config (env-overridable) -------------------------------------------------
PORT = int(os.getenv("VOICE_PORT", "8765"))
WHISPER_MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "base")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu").lower()      # "cpu" | "cuda"
KOKORO_VOICE = os.getenv("KOKORO_VOICE", "af_heart")
KOKORO_LANG = os.getenv("KOKORO_LANG", "a")                      # 'a' = American English
KOKORO_SR = 24000

VOICE_DIR = Path(__file__).parent / "voice_messages"
VOICE_DIR.mkdir(exist_ok=True)

# ---- Lazy model singletons ----------------------------------------------------
_whisper = None
_whisper_lock = asyncio.Lock()
_kpipe = None
_kpipe_lock = asyncio.Lock()


async def get_whisper():
    global _whisper
    if _whisper is not None:
        return _whisper
    async with _whisper_lock:
        if _whisper is not None:
            return _whisper

        def _load():
            from faster_whisper import WhisperModel
            if WHISPER_DEVICE == "cuda":
                try:
                    logger.info("[WHISPER] loading on CUDA (float16)...")
                    return WhisperModel(WHISPER_MODEL_SIZE, device="cuda", compute_type="float16")
                except Exception as e:  # noqa: BLE001
                    logger.warning("[WHISPER] CUDA failed (%s), falling back to CPU", e)
            logger.info("[WHISPER] loading '%s' on CPU (int8)", WHISPER_MODEL_SIZE)
            return WhisperModel(WHISPER_MODEL_SIZE, device="cpu", compute_type="int8")

        _whisper = await asyncio.get_event_loop().run_in_executor(None, _load)
        logger.info("[WHISPER] ready")
        return _whisper


async def get_kokoro():
    global _kpipe
    if _kpipe is not None:
        return _kpipe
    async with _kpipe_lock:
        if _kpipe is not None:
            return _kpipe

        def _load():
            from kokoro import KPipeline
            logger.info("[KOKORO] loading pipeline (lang=%s)...", KOKORO_LANG)
            return KPipeline(lang_code=KOKORO_LANG)

        _kpipe = await asyncio.get_event_loop().run_in_executor(None, _load)
        logger.info("[KOKORO] ready")
        return _kpipe


# ---- Text cleaning (ported verbatim from tooler prepare_text_for_tts) ---------
def prepare_text_for_tts(text: str) -> str:
    """Strip/transform markdown for natural speech."""
    text = re.sub(r"```[\s\S]*?```", " code block ", text)   # code fences -> spoken stub
    text = re.sub(r"`([^`]+)`", r"\1", text)                  # unwrap inline code
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)            # bold
    text = re.sub(r"\*([^*]+)\*", r"\1", text)                # italic
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)      # links -> link text
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)  # headers
    text = re.sub(r"\s+", " ", text).strip()
    return text


# ---- App ----------------------------------------------------------------------
app = FastAPI(title="CloudCLI voice sidecar")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "whisper_loaded": _whisper is not None,
        "kokoro_loaded": _kpipe is not None,
    }


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    start = time.time()
    suffix = Path(audio.filename or "rec.webm").suffix or ".webm"
    content = await audio.read()
    logger.info("[STT] %d bytes (%s)", len(content), audio.content_type)

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        model = await get_whisper()

        def _run():
            segments, _info = model.transcribe(tmp_path, beam_size=5)
            return "".join(seg.text for seg in segments).strip()

        text = await asyncio.get_event_loop().run_in_executor(None, _run)
        duration_ms = int((time.time() - start) * 1000)
        logger.info("[STT] %dms: %s", duration_ms, text[:100])
        return {"text": text, "duration_ms": duration_ms}
    except Exception as e:  # noqa: BLE001
        logger.error("[STT] failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


@app.post("/tts")
async def tts(text: str = Form(...)):
    if not text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    if len(text) > 8000:
        raise HTTPException(status_code=400, detail="Text too long (max 8000 chars)")

    start = time.time()
    clean = prepare_text_for_tts(text)
    # Cache on the RAW text hash (matches tooler) so identical messages reuse audio.
    key = hashlib.sha256(text.encode()).hexdigest()[:16]
    out_path = VOICE_DIR / f"{key}.wav"

    if not out_path.exists():
        try:
            pipeline = await get_kokoro()

            def _synth():
                chunks = [audio for _gs, _ps, audio in pipeline(clean, voice=KOKORO_VOICE)]
                if not chunks:
                    raise RuntimeError("Kokoro produced no audio")
                full = np.concatenate([np.asarray(c, dtype=np.float32) for c in chunks])
                sf.write(str(out_path), full, KOKORO_SR)

            await asyncio.get_event_loop().run_in_executor(None, _synth)
            logger.info("[TTS] generated %s in %dms", out_path.name, int((time.time() - start) * 1000))
        except Exception as e:  # noqa: BLE001
            logger.error("[TTS] failed: %s", e, exc_info=True)
            raise HTTPException(status_code=500, detail=f"TTS failed: {e}")
    else:
        logger.info("[TTS] cache hit %s", out_path.name)

    return Response(content=out_path.read_bytes(), media_type="audio/wav")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")

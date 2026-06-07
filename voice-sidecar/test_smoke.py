"""Smoke test: Kokoro TTS -> faster-whisper STT round-trip."""
import time
import numpy as np
import soundfile as sf

PHRASE = "Hello, this is a test of the CloudCLI voice sidecar."

print("[1/3] Loading Kokoro pipeline...")
t = time.time()
from kokoro import KPipeline
pipe = KPipeline(lang_code="a")
print(f"      loaded in {time.time()-t:.1f}s")

print("[2/3] Synthesizing...")
t = time.time()
chunks = [audio for _gs, _ps, audio in pipe(PHRASE, voice="af_heart")]
full = np.concatenate([np.asarray(c, dtype=np.float32) for c in chunks])
sf.write("test.wav", full, 24000)
dur = len(full) / 24000
print(f"      synth {time.time()-t:.1f}s -> test.wav ({dur:.1f}s audio, {len(full)} samples)")

print("[3/3] Transcribing back with faster-whisper (base, cpu int8)...")
t = time.time()
from faster_whisper import WhisperModel
model = WhisperModel("base", device="cpu", compute_type="int8")
segments, _info = model.transcribe("test.wav", beam_size=5)
text = "".join(s.text for s in segments).strip()
print(f"      transcribe {time.time()-t:.1f}s -> {text!r}")
print("\nROUND-TRIP OK" if text else "\nROUND-TRIP PRODUCED NO TEXT")

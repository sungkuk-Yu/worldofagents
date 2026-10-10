"""t_827dcbcc: 'is' 오감지 픽스 회귀용 영어 발화 fixture — smoke_voice_stt.mjs [7] 시나리오.
실행: /home/holysky87/.hermes/hermes-agent/venv/bin/python3 make_voice_fixture_en_short.py [outdir]
"""
import asyncio, sys
from pathlib import Path
import edge_tts, numpy as np

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
MP3 = OUT / "voice_fixture_en_short.mp3"
PCM = OUT / "voice_fixture_en_short.pcm"
PHRASE = "Hello, how is your day going"

async def tts():
    await edge_tts.Communicate(PHRASE, voice="en-US-AriaNeural").save(str(MP3))

def decode():
    import av
    container = av.open(str(MP3)); stream = container.streams.audio[0]
    rs = av.AudioResampler(format="s16", layout="mono", rate=16000)
    chunks = [rf.to_ndarray().reshape(-1) for frame in container.decode(stream) for rf in rs.resample(frame)]
    samples = np.concatenate(chunks).astype("<i2")
    pad = (np.zeros(int(16000*0.35), dtype="<i2"), samples, np.zeros(int(16000*0.45), dtype="<i2"))
    data = np.concatenate(pad).tobytes()
    PCM.write_bytes(data)
    print(f"OK pcm={PCM} bytes={len(data)} seconds={(len(samples)/16000):.2f} phrase={PHRASE!r}")

asyncio.run(tts()); decode()

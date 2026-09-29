"""t_9e939f43: 답변이 짧은闲聊 발화 fixture — A4 하네스 타임아웃(60s) 원인 제거.
실행: /home/holysky87/.hermes/hermes-agent/venv/bin/python3 gen_short_fixture.py <outdir>"""
import asyncio, sys
from pathlib import Path
import edge_tts, numpy as np

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
MP3 = OUT / "voice_fixture_ko_short.mp3"
PCM = OUT / "voice_fixture_ko_short.pcm"
PHRASE = "안녕, 오늘 컨디션 어때"

async def tts():
    await edge_tts.Communicate(PHRASE, voice="ko-KR-SunHiNeural").save(str(MP3))

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

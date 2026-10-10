#!/usr/bin/env python3
"""
마이에이전트톡 로컬 STT 사이드카 — faster-whisper large-v3-turbo (t_1c7be18c)

대표님 9/29 지시: "모든 STT = v3 turbo". 앱 음성 발화가 OpenAI 키 placeholder 때문에
mock 고정 문장("안녕하세요, 오늘 할 일을 정리해 주세요.")으로 대체돼 매 발화 같은
답변이 나오던 사고의 근본 조치 — 이 서버에 이미 설치된 faster-whisper 1.2.1 +
대형 v3-turbo(CT2) 모델로 실제 전사한다.

형식:
  POST /transcribe  body = raw PCM s16le 16kHz mono (백엔드 AudioStreamBuffer.bundle)
                    ?sample_rate=16000&language=ko|en (기본 자동감지)
                    -> {text, language, confidence, duration_ms, service}
  GET  /health      -> {ok, model, device, compute_type, loaded}

연결 주소/키:
  STT_SIDECAR_URL (백엔드 .env, 기본 OFF — 빈 값이면 사이드카 경로 타지 않음)
  실서비스: http://127.0.0.1:9833  (systemd user: myagenttalk-stt-sidecar.service)

주의:
  - CPU 전용. 큰 오디오(PTT 캡 10s)가 Worst case. 16코어 중 cpu_threads 상한 사용.
  - 모델 로드는 기동 시 1회 (~10-30s). /health loaded=false 동안 백엔드는 타임아웃 난다.
  - ctranslate2 모델은 concurrent transcribe 불가 → asyncio.Lock로 직렬화.
"""
import asyncio
import io
import json
import logging
import math
import os
import sys
import time

import numpy as np

MODEL = os.environ.get("STT_WHISPER_MODEL", "mobiuslabsgmbh/faster-whisper-large-v3-turbo")
DEVICE = os.environ.get("STT_DEVICE", "cpu")
COMPUTE = os.environ.get("STT_COMPUTE_TYPE", "int8")
CPU_THREADS = int(os.environ.get("STT_CPU_THREADS", "8"))
HOST = os.environ.get("STT_SIDECAR_HOST", "127.0.0.1")
PORT = int(os.environ.get("STT_SIDECAR_PORT", "9833"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s stt-sidecar %(levelname)s %(message)s")
log = logging.getLogger("stt")

# t_827dcbcc: ?language= 힌트 화이트리스트 — faster-whisper가 실제 받는 코드만 통과(500 원천 차단).
# 라이브러리 import 실패 시에도 계약 언어(ko/en)는 보장한다.
try:
    from faster_whisper.tokenizer import _LANGUAGE_CODES as _FW_LANGUAGES
    VALID_LANGUAGE_CODES = frozenset(_FW_LANGUAGES)
except Exception:
    VALID_LANGUAGE_CODES = frozenset({"ko", "en"})

_model = None
_model_ready = False
_lock = asyncio.Lock()


def load_model():
    global _model, _model_ready
    from faster_whisper import WhisperModel

    t0 = time.monotonic()
    # local_files_only: HF 캐시(mobiuslabsgmbh CT2)에 이미 있는 모델만 — 오프라인/재부팅 안전
    try:
        _model = WhisperModel(MODEL, device=DEVICE, compute_type=COMPUTE, cpu_threads=CPU_THREADS, local_files_only=True)
    except Exception as e:  # 캐시 미비 시에만 다운로드 허용
        log.warning("cache miss (%s) — downloading %s", e, MODEL)
        _model = WhisperModel(MODEL, device=DEVICE, compute_type=COMPUTE, cpu_threads=CPU_THREADS)
    _model_ready = True
    log.info("model %s loaded on %s/%s in %.1fs", MODEL, DEVICE, COMPUTE, time.monotonic() - t0)


def pcm_to_float32(raw: bytes, sample_rate: int) -> np.ndarray:
    """s16le PCM 바이트 → faster-whisper가 받는 float32 [-1,1] 16k 배열."""
    samples = np.frombuffer(raw, dtype="<i2")
    if sample_rate != 16000:
        # 백엔드 계약은 16kHz 고정. 그 외는 단순 리샘플(선형)로 방어.
        n16 = int(len(samples) * 16000 / sample_rate)
        idx = np.linspace(0, len(samples) - 1, n16)
        x = samples.astype(np.float64)
        samples = np.interp(idx, np.arange(len(x)), x).astype(np.int16)
    return samples.astype(np.float32) / 32768.0


def transcribe_blocking(raw: bytes, language: str | None):
    audio = pcm_to_float32(raw, 16000)
    dur = len(audio) / 16000.0
    segs, info = _model.transcribe(
        audio,
        language=language or None,
        beam_size=5,
        vad_filter=False,        # 백엔드 VAD가 이미 트림한 오디오
        condition_on_previous_text=False,  # PTT 단위 발화 — 이전 문맥 오염 금지
    )
    texts, wsum, logprob_sum = [], 0.0, 0.0
    for s in segs:
        texts.append(s.text.strip())
        w = max(s.end - s.start, 0.01)
        logprob_sum += (s.avg_logprob or -1.0) * w
        wsum += w
    text = " ".join(t for t in texts if t).strip()
    avg = logprob_sum / wsum if wsum else -1.0
    confidence = max(0.0, min(1.0, math.exp(avg))) if text else 0.0
    return {
        "text": text,
        "language": info.language or (language or "ko"),
        "confidence": round(confidence, 3),
        "duration_ms": round(dur * 1000),
        "service": "local",
    }


def create_app():
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse

    app = FastAPI()

    @app.on_event("startup")
    async def _startup():
        loop = asyncio.get_running_loop()
        loop.run_in_executor(None, load_model)  # 워머 — 준비 전 요청은 503

    @app.get("/health")
    async def health():
        return {"ok": True, "loaded": _model_ready, "model": MODEL, "device": DEVICE, "compute_type": COMPUTE}

    @app.post("/transcribe")
    async def transcribe(request: Request):
        if not _model_ready:
            return JSONResponse({"error": "MODEL_NOT_LOADED"}, status_code=503)
        raw = await request.body()
        if len(raw) < 3200:  # 0.1s 미만은 전사 불가로 본다
            return {"text": "", "language": "ko", "confidence": 0.0, "duration_ms": 0, "service": "local"}
        qp = request.query_params
        # t_827dcbcc: 힌트 정규화 — 'auto'/빈값/비코드는 자동감지(None)로 폴백.
        # 'auto'를 그대로 transcribe에 넘기면 faster-whisper ValueError(500) (10/10 실측).
        language = (qp.get("language") or "").strip().lower() or None
        if language == "auto":
            language = None
        if language is not None and language not in VALID_LANGUAGE_CODES:
            log.warning("invalid language hint %r — auto-detect fallback", language)
            language = None
        try:
            async with _lock:
                loop = asyncio.get_running_loop()
                t0 = time.monotonic()
                result = await loop.run_in_executor(None, transcribe_blocking, raw, language)
            # 계약#2 override 기록: 힌트가 실 감지언어를 덮었다면 (실제감지=힌트 아님) 로그에 명시.
            if language and result.get("language") != language:
                log.warning("language hint %r overrode detected %r", language, result.get("language"))
            log.info("transcribe %dms audio → %dms infer (lang_hint=%s): %r",
                     len(raw) // 32, (time.monotonic() - t0) * 1000, language or "-", result["text"][:60])
            return result
        except Exception as e:
            log.exception("transcribe failed")
            return JSONResponse({"error": f"TRANSCRIBE_FAILED: {e}"}, status_code=500)

    return app


if __name__ == "__main__":
    import uvicorn

    log.info("starting stt sidecar on %s:%d model=%s", HOST, PORT, MODEL)
    uvicorn.run(create_app(), host=HOST, port=PORT, log_level="warning")

#!/usr/bin/env python3
"""볼트 도서관 증분 갱신 크론 래퍼 (t_d469fac3) — 일 1회.

우선 경로: 사이드카 POST /update (인덱서 내장 호출 + 메모리 벡터 캐시 즉시 재로딩 — 무중단).
폴백: 사이드카 미기동 시 vault_index.py update를 직접 실행 (DB만 갱신, 다음 기동 시 loaded).

설치 (holysky87 crontab -e):
  17 4 * * * /home/holysky87/.hermes/hermes-agent/venv/bin/python3 /home/holysky87/worldofagents/apps/backend/cron/vault_index_update.py >> /home/holysky87/.hermes/vault-index/cron.log 2>&1
참고: 사이드카/타이머 systemd 운용 시엔 유닛이 이미 이 역할을 수행 — cron은 수동 서버용 대안.
"""
import json
import subprocess
import sys
import urllib.request

PY = sys.executable
SIDECAR = "http://127.0.0.1:9834"
SCRIPT = "/home/holysky87/worldofagents/apps/backend/scripts/vault_index.py"


def post_update(timeout: int = 1800):
    req = urllib.request.Request(SIDECAR + "/update", data=b"", method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def main():
    try:
        result = post_update()
        print("sidecar /update:", json.dumps(result, ensure_ascii=False)[:400])
        if not result.get("ok"):
            sys.exit(1)
    except Exception as e:
        print("sidecar unreachable (%s) — direct update" % e)
        proc = subprocess.run([PY, SCRIPT, "update"], capture_output=True, text=True, timeout=3600)
        print(proc.stdout.strip() or proc.stderr.strip()[-300:])
        sys.exit(proc.returncode)


if __name__ == "__main__":
    main()

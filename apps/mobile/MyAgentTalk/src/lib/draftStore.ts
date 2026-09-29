// ④ room별 미전송 입력 드래프트 (t_5c559e85, core.telegram.org/api/drafts 규범)
// 웹 MVP는 localStorage 저장(네이티브는 localStorage 부재 → 조용히 no-op, 메모리 입력만 유지).
// 계약: 입력 변경 디바운스 저장 / 발송 시작 시 원자적 clear(대기 타이머 취소 포함 — 낡은 저장 재발 금지)
//      / 화면 떠남(언마운트) flush / 실패 복구는 화면의 restoreFailedDraft가 입력에 복귀시키면
//      디바운스 저장기가 다시 드래프트로 승격한다(실패 원문 유실 금지).
const KEY = (sessionId: string) => `at-draft-${sessionId}`;

function store(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null; // 사모드/차단 브라우저 — 드래프트 없이 세션 유지
  }
}

export function readDraft(sessionId: string): string {
  const raw = store()?.getItem(KEY(sessionId)) ?? null;
  return typeof raw === 'string' ? raw : '';
}

/** 빈 문자열 = 삭제(드래프트는 미전송 텍스트가 있는 동안만 존재). */
export function writeDraft(sessionId: string, text: string): void {
  const ls = store();
  if (!ls) return;
  try {
    if (text) ls.setItem(KEY(sessionId), text);
    else ls.removeItem(KEY(sessionId));
  } catch { /* 저장소 부재/할당 실패 — 입력 자체는 메모리에 유지 */ }
}

export function clearDraft(sessionId: string): void {
  writeDraft(sessionId, '');
}

export interface DraftSaver {
  schedule(sessionId: string, text: string): void;
  flush(): void;
  clearNow(sessionId: string): void;
}

/** 디바운스 저장기 — 마지막 입력만 저장(키바이트마다 localStorage 금지). */
export function createDraftSaver(delayMs = 350): DraftSaver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cur: { sid: string; text: string } | null = null;
  const drop = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };
  return {
    schedule(sessionId, text) {
      cur = { sid: sessionId, text };
      drop();
      timer = setTimeout(() => { timer = null; if (cur) { writeDraft(cur.sid, cur.text); cur = null; } }, delayMs);
    },
    flush() {
      drop();
      if (cur) { writeDraft(cur.sid, cur.text); cur = null; }
    },
    clearNow(sessionId) {
      drop(); // 대기 중인 낡은 텍스트 저장을 반드시 먼저 폐기 — clear 후 재발생(유령 드래프트) 방지
      cur = null;
      writeDraft(sessionId, '');
    },
  };
}

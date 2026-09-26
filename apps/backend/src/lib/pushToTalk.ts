/**
 * Push-to-Talk 세그먼트 로직 (t_d75ca81c — 대표님 9/26 야간 지시).
 *
 * 대표님 프레임 (카드 t_eded715c 코멘트로 확정):
 *  - PC 웹: 키보드 단축키(기본 V) 누르는 동안 녹음 → 놓으면 즉시 전송 (Discord PTT 관습)
 *  - 모바일 웹: 터치 홀드 PTT (손가락 유지 동안 녹음, 릴리스 전송)
 *  - 모바일 앱: 조이스틱 롱프레스 = 연속 음성 (기 구현)
 *
 * 백엔드 계약: 기존 audio.start/end/cancel 프로토콜이 그대로 PTT 캐리어다.
 * 이 모듈은 PTT 전용 상태머신 — 홀드 중 무음(VAD false)이 계속되는 runaway을
 * 타임아웃으로 종료하고, 릴리스(audio.end) 시 전송 여부를 결정한다.
 * (누르고만 있다가 놓지 않는 실수/탭 백그라운드 이탈 대응 — 클라이언트가
 *  cancel을 못 보내는 상황의 서버측 안전망.)
 */
import { config } from '../config';

export type PttMode = 'hold' | 'toggle';

/** audio.start 부가 필드 — 미지정 시 'hold'(디스코드식). */
export interface PttStartOptions {
  mode?: PttMode;
  /** 디바이스 라벨 ('pc-web' | 'mobile-web' | ...) — presence/진단용, 없으면 'unknown' */
  device?: string;
}

export function normalizePttMode(mode: unknown): PttMode {
  return mode === 'toggle' ? 'toggle' : 'hold';
}

export function normalizeDeviceLabel(device: unknown): string {
  if (typeof device !== 'string') return 'unknown';
  const trimmed = device.trim().toLowerCase();
  const allowed = ['pc-web', 'mobile-web', 'ios', 'android', 'desktop-app', 'unknown'];
  return (allowed.includes(trimmed) ? trimmed : 'unknown') as string;
}

export interface PttActivity {
  /** 마지막 음성 활동 시각 (epoch ms) */
  lastVoiceAt: number;
  /** 세그먼트 시작 시각 (epoch ms) */
  startedAt: number;
}

/**
 * 홀드 중 무음 타임아웃 여부. PTT는 릴리스로 끝나지만, 릴리스 이벤트가
 * 도달하지 않는 세션(탭 강제종료 등)에서도 1턴 분 오디오가 무한 누적되지 않게
 * `silenceTimeoutMs` 동안 무음이면 종료 판단한다.
 */
export function isPttIdleTimeout(activity: PttActivity, now: number, silenceTimeoutMs = config.pushToTalk.silenceTimeoutMs): boolean {
  return now - activity.lastVoiceAt >= silenceTimeoutMs;
}

/** 홀드 상한: maxHoldMs 초과 세그먼트는 클라이언트가 audio.end/cancel을 못 보내도 서버가 종료한다. */
export function isPttHoldOverflow(activity: PttActivity, now: number, maxHoldMs = config.pushToTalk.maxHoldMs): boolean {
  return now - activity.startedAt >= maxHoldMs;
}

// 컴포넌트 단위 테스트 — 조이스틱 8방향 제스처 순수 로직 (src/lib/gesture.ts)
// ui-interaction-spec.md §1.3 (deadzone / directionThreshold / 22.5° 각도 스냅)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getDirection,
  isOutsideDeadzone,
  isTap,
  DEFAULT_DIRECTION_LABELS,
  DIRECTION_ARROWS,
  GESTURE_CONFIG,
  selectAction,
  selectActionLabelKey,
  labelKeyForStageAction,
  armedCompassLabelKey,
  inlineCompassLabelKey,
  STAGE_ACTION_LABEL_KEYS,
  COMPASS_DIRECTIONS,
  type StageAction,
} from '../../src/lib/gesture';

// ── 8방향 스냅 ─────────────────────────────────
test('8방향: 축 방향 제스처를 정확히 스냅한다', () => {
  assert.equal(getDirection(0, -40), 'DIR_UP'); // 위
  assert.equal(getDirection(0, 40), 'DIR_DOWN'); // 아래
  assert.equal(getDirection(40, 0), 'DIR_RIGHT'); // 오른쪽
  assert.equal(getDirection(-40, 0), 'DIR_LEFT'); // 왼쪽
});

test('8방향: 대각선 45° 제스처를 정확히 스냅한다', () => {
  const d = 40 / Math.SQRT2; // 45° 대각 거리
  assert.equal(getDirection(d, -d), 'DIR_UPRIGHT'); // 오른쪽 위
  assert.equal(getDirection(d, d), 'DIR_DOWNRIGHT'); // 오른쪽 아래
  assert.equal(getDirection(-d, d), 'DIR_DOWNLEFT'); // 왼쪽 아래
  assert.equal(getDirection(-d, -d), 'DIR_UPLEFT'); // 왼쪽 위
});

test('8방향: 인접 경계 근처에서 가장 가까운 방향으로 스냅한다', () => {
  // 20° 기울기(≈0°에 가까움)는 DIR_UP 으로
  assert.equal(getDirection(Math.sin(Math.PI / 9) * 60, -Math.cos(Math.PI / 9) * 60), 'DIR_UP');
  // 22.5° 스냅 경계: 25° 는 0°보다 45°(오른쪽 위)에 가까움 → DIR_UPRIGHT
  assert.equal(getDirection(Math.sin((25 * Math.PI) / 180) * 60, -Math.cos((25 * Math.PI) / 180) * 60), 'DIR_UPRIGHT');
  // 40° 는 45°(오른쪽 위)에 더 가까움
  assert.equal(getDirection(Math.sin((40 * Math.PI) / 180) * 60, -Math.cos((40 * Math.PI) / 180) * 60), 'DIR_UPRIGHT');
  // 70° 는 45°보다 90°(오른쪽)에 가까움
  assert.equal(getDirection(Math.sin((70 * Math.PI) / 180) * 60, -Math.cos((70 * Math.PI) / 180) * 60), 'DIR_RIGHT');
});

test('deadzone: 방향 임계값 미만이면 null', () => {
  assert.equal(getDirection(0, 0), null);
  assert.equal(getDirection(GESTURE_CONFIG.directionThreshold - 1, 0), null);
  assert.equal(getDirection(0, GESTURE_CONFIG.directionThreshold - 1), null);
});

test('deadzone: 정확히 임계값 이상이면 방향 확정', () => {
  assert.equal(getDirection(0, -GESTURE_CONFIG.directionThreshold), 'DIR_UP');
});

// ── 데드존 / 탭 ─────────────────────────────────
test('isOutsideDeadzone: 유클리드 거리 기준 데드존 판별', () => {
  assert.equal(isOutsideDeadzone(0, 0), false);
  assert.equal(isOutsideDeadzone(GESTURE_CONFIG.deadzone - 1, 0), false);
  assert.equal(isOutsideDeadzone(GESTURE_CONFIG.deadzone, 0), true);
  assert.equal(isOutsideDeadzone(6, 8), false); // sqrt(36+64)=10 < 12 → 데드존 내부
  assert.equal(isOutsideDeadzone(9, 12), true); // sqrt(81+144)=15 >= 12 → 데드존 외부
});

test('isTap: 200ms 이내만 탭으로 인식', () => {
  assert.equal(isTap(0), true);
  assert.equal(isTap(GESTURE_CONFIG.tapMaxDuration), true);
  assert.equal(isTap(GESTURE_CONFIG.tapMaxDuration + 1), false);
  assert.equal(isTap(500), false);
});

// ── 라벨/화살표 완결성 ─────────────────────────
test('모든 8방향 + 중앙 제스처에 라벨·화살표가 존재한다', () => {
  for (const g of [
    'TAP_CENTER', 'LONG_CENTER',
    'DIR_UP', 'DIR_UPRIGHT', 'DIR_RIGHT', 'DIR_DOWNRIGHT',
    'DIR_DOWN', 'DIR_DOWNLEFT', 'DIR_LEFT', 'DIR_UPLEFT',
  ] as const) {
    assert.ok(DEFAULT_DIRECTION_LABELS[g], `라벨 누락: ${g}`);
    assert.ok(DIRECTION_ARROWS[g], `화살표 누락: ${g}`);
  }
});
// ── t_55e92e7e: 섹터→라벨 매핑 순수함수 (카드 게이트 ①) ─────────────────
test('라벨 매핑: 5방향 섹터 → i18n 키, send(센터·무매칭 영역) → null', () => {
  const R = 48; // 패드 반경 (STAGE_RING/2과 동일 계)
  assert.equal(selectActionLabelKey(0, 40, R), 'chat.joystickLabelKeyboard');   // ↑ 12시
  assert.equal(selectActionLabelKey(36, 40, R), 'chat.joystickLabelFile');      // ↗ 1시 (31~45; 30° 경계는 keyboard ±30 선점 — 기존 selectAction first-match 계약)
  assert.equal(selectActionLabelKey(90, 40, R), 'chat.joystickLabelEdit');      // → 3시
  assert.equal(selectActionLabelKey(180, 40, R), 'chat.joystickLabelPhoto');    // ↓ 6시
  assert.equal(selectActionLabelKey(270, 40, R), 'chat.joystickLabelCancel');   // ← 9시
  // 센터 데드존(반경*0.4) 이내 = send = 라벨 없음
  assert.equal(selectActionLabelKey(0, 10, R), null);
  // 매칭 없는 갭 영역(45~60 사이의 50°, 120~150 사이의 140°, 210~240 사이의 225°) = send = 라벨 없음
  assert.equal(selectActionLabelKey(50, 40, R), null);
  assert.equal(selectActionLabelKey(140, 40, R), null);
  assert.equal(selectActionLabelKey(225, 40, R), null);
  // 섹터 경계는 포함(≤ halfWidth): 240° = cancel 하한, 150° = photo 하한, 60° = edit 하한
  assert.equal(selectActionLabelKey(240, 40, R), 'chat.joystickLabelCancel');
  assert.equal(selectActionLabelKey(150, 40, R), 'chat.joystickLabelPhoto');
  assert.equal(selectActionLabelKey(60, 40, R), 'chat.joystickLabelEdit');
});

test('라벨 경계: ±30° 섹터 하한/상한은 경합 시 우선 매칭(first-match), send 강등 금지', () => {
  const R = 48;
  // 12:00 키보드 ±30 → 30° 지점: 파일 섹터(15~45)보다 먼저 정의된 키보드(0±30) 매칭 — selectAction 계약 불변
  assert.equal(selectAction(30, 40, R), 'keyboard');
  assert.equal(selectAction(31, 40, R), 'file');
  assert.equal(selectActionLabelKey(31, 40, R), 'chat.joystickLabelFile');
  // 편집 섹터 경계 60~120
  assert.equal(selectAction(59, 40, R), 'send'); // 파일(≤45)·편집(≥60) 사이 갭
  assert.equal(selectAction(60, 40, R), 'edit');
  assert.equal(selectAction(120, 40, R), 'edit');
  assert.equal(selectAction(121, 40, R), 'send');
});

test('labelKeyForStageAction: send=null, 그 외 5종 STAGE_ACTION_LABEL_KEYS와 동일', () => {
  assert.equal(labelKeyForStageAction('send'), null);
  for (const [action, key] of Object.entries(STAGE_ACTION_LABEL_KEYS) as [Exclude<StageAction, 'send'>, string][]) {
    assert.equal(labelKeyForStageAction(action), key);
  }
});

test('나침반 항목: labelKey 완결 — STAGE_ACTION_LABEL_KEYS와 전사 일치', () => {
  assert.equal(COMPASS_DIRECTIONS.length, 5);
  for (const d of COMPASS_DIRECTIONS) {
    assert.equal(d.labelKey, STAGE_ACTION_LABEL_KEYS[d.action as Exclude<StageAction, 'send'>], d.action);
  }
});

test('arm 배너 판정: send/null = 배너 없음, ackActive 좌우 = ack 배너에 양도(null), 그 외 = 섹터 라벨', () => {
  // 비ack 모드: 진입 섹터 = 그 라벨
  assert.equal(armedCompassLabelKey({ ackActive: false, ackPhrase: null, activeAction: 'keyboard' }), 'chat.joystickLabelKeyboard');
  assert.equal(armedCompassLabelKey({ ackActive: false, ackPhrase: null, activeAction: 'cancel' }), 'chat.joystickLabelCancel');
  assert.equal(armedCompassLabelKey({ ackActive: false, ackPhrase: null, activeAction: 'send' }), null);
  assert.equal(armedCompassLabelKey({ ackActive: false, ackPhrase: null, activeAction: null }), null);
  // ackActive + 좌/우 끝 스냅 = 릴리스 실행은 ack 문장 — 링 하단 joystick-ack-armed가 전담(배너 중복 금지)
  assert.equal(armedCompassLabelKey({ ackActive: true, ackPhrase: 'yes', activeAction: 'cancel' }), null);
  assert.equal(armedCompassLabelKey({ ackActive: true, ackPhrase: 'no', activeAction: 'edit' }), null);
  // ackActive여도 다른 방향(↑/↗/↓)은 섹터 라벨 그대로
  assert.equal(armedCompassLabelKey({ ackActive: true, ackPhrase: null, activeAction: 'photo' }), 'chat.joystickLabelPhoto');
});

test('인라인 라벨 판정: 진입 항목만 라벨, ackActive 좌/우는 실행 문장(예/아니요)로 우선 표시', () => {
  // 비ack: 진입된 항목만, 그 외 화살표만(null)
  assert.equal(inlineCompassLabelKey({ ackActive: false, ackPhrase: null, activeAction: 'keyboard', itemAction: 'keyboard' }), 'chat.joystickLabelKeyboard');
  assert.equal(inlineCompassLabelKey({ ackActive: false, ackPhrase: null, activeAction: 'keyboard', itemAction: 'cancel' }), null);
  assert.equal(inlineCompassLabelKey({ ackActive: false, ackPhrase: null, activeAction: 'send', itemAction: 'keyboard' }), null);
  assert.equal(inlineCompassLabelKey({ ackActive: false, ackPhrase: null, activeAction: null, itemAction: 'file' }), null);
  // ackActive + ← 끝(실행='예'): cancel 항목 라벨이 '예'로 교체 — 화면/실행 불일치 금지
  assert.equal(inlineCompassLabelKey({ ackActive: true, ackPhrase: 'yes', activeAction: 'cancel', itemAction: 'cancel' }), 'chat.ackYes');
  assert.equal(inlineCompassLabelKey({ ackActive: true, ackPhrase: 'yes', activeAction: 'cancel', itemAction: 'edit' }), null);
  // ackActive + → 끝(실행='아니요'): edit 항목 라벨이 '아니요'로
  assert.equal(inlineCompassLabelKey({ ackActive: true, ackPhrase: 'no', activeAction: 'edit', itemAction: 'edit' }), 'chat.ackNo');
  // ackActive + ackPhrase 없음(↑/↗/↓ 진입): 섹터 라벨 그대로
  assert.equal(inlineCompassLabelKey({ ackActive: true, ackPhrase: null, activeAction: 'keyboard', itemAction: 'keyboard' }), 'chat.joystickLabelKeyboard');
});

test('arm 배너 supported 게이트: 실행 콜백 없는 액션은 \'놓으면 실행\' 배너 억제 (화면-거짓 방지)', () => {
  const SUP = ['keyboard', 'cancel', 'photo', 'file'] as StageAction[]; // onEdit 미배선 현재 계
  assert.equal(armedCompassLabelKey({ ackActive: false, ackPhrase: null, activeAction: 'keyboard', supported: SUP }), 'chat.joystickLabelKeyboard');
  assert.equal(armedCompassLabelKey({ ackActive: false, ackPhrase: null, activeAction: 'cancel', supported: SUP }), 'chat.joystickLabelCancel');
  assert.equal(armedCompassLabelKey({ ackActive: false, ackPhrase: null, activeAction: 'photo', supported: SUP }), 'chat.joystickLabelPhoto');
  assert.equal(armedCompassLabelKey({ ackActive: false, ackPhrase: null, activeAction: 'file', supported: SUP }), 'chat.joystickLabelFile');
  assert.equal(armedCompassLabelKey({ ackActive: false, ackPhrase: null, activeAction: 'edit', supported: SUP }), null);
  // supported 생략 = 무 게이트 (후방 호환)
  assert.equal(armedCompassLabelKey({ ackActive: false, ackPhrase: null, activeAction: 'edit' }), 'chat.joystickLabelEdit');
});

test('arm 배너 supported 게이트 — t_616e9abf →편집 배선 전환: VoiceStage armedActions 실세트', () => {
  // VoiceStage: ...(onEdit ? ['edit'] : []) — onEdit 전달 시(현재 ChatScreen 배선) edit 포함.
  const WIRED = ['keyboard', 'cancel', 'edit', 'photo', 'file'] as StageAction[];   // onEdit 장착 계
  const GAPS = ['keyboard', 'cancel', 'photo', 'file'] as StageAction[];            // onEdit absent 폴백 계
  assert.equal(armedCompassLabelKey({ ackActive: false, ackPhrase: null, activeAction: 'edit', supported: WIRED }), 'chat.joystickLabelEdit', '배선 전환 = 배너 참(화면-약속 일치)');
  assert.equal(armedCompassLabelKey({ ackActive: false, ackPhrase: null, activeAction: 'edit', supported: GAPS }), null, '미장착 폴백(비보이스 화면 등)은 여전히 억제');
});

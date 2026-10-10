/**
 * smoke_compass_t08d671a8.cjs — 5방향 나침반 조이스틱 회귀 (대표님 10/4)
 * 지시 요약:
 *   ↑ (12시): 키보드
 *   ← (9시): 취소
 *   → (3시): 수정
 *   ↓ (6시): 사진
 *   ↗ (1시): 파일
 *   센터: 전송
 *
 * t_55e92e7e (대표님 10/10) 확장 — 방향=동작 인라인 라벨:
 *   ④ 노브를 5방향 각각 진입 시 대응 라벨 textID(compass-label-<action>) 존재 + 인라인 글자,
 *      반대 방향 라벨 미존재. #mat-callout 서브트리 user-select:none 상속 실측.
 *      단, 실행 배선 없는 방향은 arm 배너 억제(t_08d671a8 온보드 갭): →(편집)만 해당 —
 *      인라인 섹터 라벨(의미)은 표시, '놓으면 실행' 배너(약속)는 미표시 (화면-거짓 방지).
 *      [t_616e9abf 배선 전환] → 편집 = ptt.endHoldDraft(audio.end{draft:true}) 실행 장착 —
 *      5방향 전부 배선/전부 배너 (④ DIRS·⑥-d 참조).
 *   ⑤ 릴리스 실행 로그 유지 — 센터=audio.start→end(send), ←=audio.cancel, ↑=audio.cancel+B 개방.
 *   ⑥ 실행 배선 (본 카드 후속): ↓=사진첨부·↗=파일첨부 릴리스 시 첨부 스테이지 칩 실물 +
 *      /api/upload POST (라벨의 '놓으면 실행'을 참으로). ←/↑ 기존 실행 회귀 동시 잠금.
 *
 * 검사:
 *   ① 홀드 시 나침반(5방향 화살표) 상단 클러스터 렌더 — rect ∩ 패드+하단 20% = 0
 *   ② 각 방향 드래그 시 해당 화살표 강조 (opacity 상승)
 *   ③ selectAction 단위 로직 — 각도→액션 매핑 경계 (gesture.test.ts 이관)
 *   ④⑤ (t_55e92e7e 라벨·실행)
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('/home/holysky87/worldofagents/docs/design/agenttalk-figma/node_modules/playwright-core');
const { installFixtures } = require('./run_c_fixtures.cjs');

const APP_URL = process.env.APP_URL || 'http://localhost:8080';
const ART = path.join(__dirname, 'artifacts', 'compass-labels-t55e92e7e');
try { fs.mkdirSync(ART, { recursive: true }); } catch {}
const EXE = '/home/holysky87/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const results = [];
function check(label, pass, info = '') { results.push({ label, pass }); console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${info ? ' — ' + info : ''}`); }

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  try {
    // ── 모바일 390x844 ──
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    const stub = {}; // /api/upload 카운터 (⑥ 검증)
    const ws = await installFixtures(page, { reader: true, uploadStub: stub });
    const state = ws;
    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.getByTestId('session-card').click();
    await page.getByTestId('voice-stage').waitFor({ timeout: 15000 });
    await page.waitForSelector('[data-testid="voice-stage-pad"]', { timeout: 8000 });

    // ① 나침반 비가시 (idle)
    const compassIdle = await page.getByTestId('voice-compass-row').boundingBox().catch(() => null);
    check('① idle 상태 나침반 미표시', compassIdle === null);

    // 홀드 시작 — 나침반 표시 확인
    const pad = await page.getByTestId('voice-stage-pad').boundingBox();
    await page.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(300);

    const compass = await page.getByTestId('voice-compass-row').boundingBox().catch(() => null);
    check('① 홀드 중 나침반 표시', !!compass, compass ? `y=${compass.y.toFixed(0)}` : '없음');

    // 나침반이 패드+하단 20% 영역과 겹치지 않는지
    if (compass && pad) {
      const bottom20 = 844 * 0.8; // 하단 20% 시작
      const compassBottom = compass.y + compass.height;
      const padTop = pad.y;
      const noOverlap = compassBottom < Math.min(padTop, bottom20);
      check('① 나침반 rect ∩ (패드+하단20%) = 0', noOverlap, `compass.bottom=${compassBottom.toFixed(0)} padTop=${padTop.toFixed(0)} h80%=${bottom20.toFixed(0)}`);
    }

    // ② 방향 드래그 시 강조 확인 (↑ 키보드)
    const cx = pad.x + pad.width / 2, cy = pad.y + pad.height / 2;
    const dragTo = async (dx, dy) => {
      await page.mouse.move(cx, cy);
      await page.mouse.move(cx + dx, cy + dy, { steps: 4 });
      await page.waitForTimeout(120);
    };
    await dragTo(0, -40); // ↑ 40px: 거리 40 > 센터데드존 19.2 (48*0.4), 각도 0° = keyboard
    const kbdEl = page.getByTestId('compass-keyboard');
    const kbdStyle = await kbdEl.evaluate((el) => getComputedStyle(el).opacity).catch(() => '0');
    check('② ↑ 드래그 시 키보드 강조', parseFloat(kbdStyle) > 0.7, `opacity=${kbdStyle}`);

    // ④ t_55e92e7e: 5방향 진입 → 대응 라벨 존재 + 반대 라벨 미존재 + 인라인 글자 + arm 배너
    //   t_55e92e7e 실행 배선 후속: '놓으면 실행' 배너(supported 게이트) = 실행 콜백 장착 방향만.
    //   t_616e9abf: → 편집 = endHoldDraft(audio.end{draft:true}) 실행 배선 전환 — 5방향 전부
    //   배선됨(arm 배너 참). 인라인 섹터 라벨(의미)은 상시, 배너(약속)는 실행 존재 시에만.
    const DIRS = [
      { action: 'keyboard', dx: 0, dy: -40, text: '키보드 열기', opposite: 'cancel', wired: true },
      { action: 'file', dx: 23, dy: -33, text: '파일', opposite: 'cancel', wired: true },   // ↗ ~35° (keyboard 30° 초과, file 15~45 내)
      { action: 'edit', dx: 40, dy: 0, text: '편집', opposite: 'cancel', wired: true },     // t_616e9abf 배선 전환: 미배선→endHoldDraft 실행 (arm 배너 참)
      { action: 'photo', dx: 0, dy: 40, text: '사진', opposite: 'keyboard', wired: true },
      { action: 'cancel', dx: -40, dy: 0, text: '취소', opposite: 'edit', wired: true },
    ];
    for (const d of DIRS) {
      await dragTo(d.dx, d.dy);
      const entryText = (await page.getByTestId(`compass-${d.action}`).innerText().catch(() => '')).trim();
      const armLabel = page.getByTestId(`compass-label-${d.action}`);
      const armCount = await armLabel.count();
      const armText = armCount ? (await armLabel.innerText()).trim() : '';
      const oppText = (await page.getByTestId(`compass-${d.opposite}`).innerText().catch(() => '')).trim();
      const oppArm = await page.getByTestId(`compass-label-${d.opposite}`).count();
      check(`④ ${d.action} 진입 시 인라인 라벨 '${d.text}'`, entryText.includes(d.text), JSON.stringify(entryText));
      if (d.wired) {
        check(`④ ${d.action} arm 배너(compass-label-${d.action}) 존재+'놓으면 실행'`, armCount === 1 && armText.includes(d.text) && armText.includes('놓으면 실행'), JSON.stringify(armText));
      } else {
        check(`④ ${d.action} 미배선 = arm 배너 억제(화면-거짓 방지), 인라인 라벨은 표시`, armCount === 0 && entryText.includes(d.text), JSON.stringify({ armCount, entryText }));
      }
      check(`④ ${d.action} 진입 시 반대(${d.opposite}) 라벨 미존재`, !oppText.includes('파일') && !oppText.includes('편집') && !oppText.includes('취소') && !oppText.includes('사진') && !oppText.includes('키보드') && oppArm === 0, JSON.stringify({ oppText, oppArm }));
    }
    // ④ t_5131cb09 봉인 상속: 라벨 Text는 #mat-callout 서브트리 — user-select:none 실측
    const sealCheck = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="compass-label-cancel"]');
      if (!el) return { ok: false, why: 'no-el' };
      const cs = getComputedStyle(el);
      return { ok: cs.userSelect === 'none', why: `userSelect=${cs.userSelect}` };
    });
    check('④ arm 라벨 user-select:none 상속 (#mat-callout 봉인)', sealCheck.ok, sealCheck.why);

    // ④ 센터(deadzone) 귀환 = 라벨 소멸 (send = 기본 동작, 라벨 없음)
    await dragTo(0, 0);
    const centerArms = await page.evaluate(() => document.querySelectorAll('[data-testid^="compass-label-"]').length);
    check('④ 센터 귀환 = arm 라벨 0건 (send 라벨 없음 계약)', centerArms === 0, `count=${centerArms}`);

    // ⑤ t_55e92e7e 게이트: 릴리스 동작 실행 로그 유지 — 센터 릴리스 = audio.start→audio.end (send)
    const frameBase = state.frames.length;
    await page.mouse.up();
    await page.waitForTimeout(500);
    const typesAfter = state.frames.slice(frameBase).filter((f) => f && typeof f.type === 'string').map((f) => f.type);
    check('⑤ 센터 릴리스 실행 로그: audio.end (send) — start 포함', typesAfter.includes('audio.end') && !typesAfter.includes('audio.cancel'), typesAfter.join(','));

    // ⑤ ← 릴리스 = cancel: audio.cancel 로그 + 라벨 소멸
    const pad2 = await page.getByTestId('voice-stage-pad').boundingBox();
    const cx2 = pad2.x + pad2.width / 2, cy2 = pad2.y + pad2.height / 2;
    await page.mouse.move(cx2, cy2);
    await page.mouse.down();
    await page.mouse.move(cx2 - 40, cy2, { steps: 4 });
    await page.waitForTimeout(150);
    const armBeforeCancel = await page.getByTestId('compass-label-cancel').count();
    const frameBase2 = state.frames.length;
    await page.mouse.up();
    await page.waitForTimeout(400);
    const typesCancel = state.frames.slice(frameBase2).filter((f) => f && typeof f.type === 'string').map((f) => f.type);
    check('⑤ ← 진입 중 arm 배너 노출 후 릴리스 = audio.cancel 실행 로그', armBeforeCancel === 1 && typesCancel.includes('audio.cancel') && !typesCancel.includes('audio.end'), `arm=${armBeforeCancel} ${typesCancel.join(',')}`);
    const labelsGone = await page.evaluate(() => document.querySelectorAll('[data-testid^="compass-label-"]').length);
    check('⑤ 릴리스 후 라벨 소멸 (잔상 0)', labelsGone === 0, `count=${labelsGone}`);

    // ⑤ ↑ 릴리스 = keyboard: audio.cancel + B 계층(chat-input) 개방 로그
    const pad3 = await page.getByTestId('voice-stage-pad').boundingBox();
    const cx3 = pad3.x + pad3.width / 2, cy3 = pad3.y + pad3.height / 2;
    await page.mouse.move(cx3, cy3);
    await page.mouse.down();
    await page.mouse.move(cx3, cy3 - 40, { steps: 4 });
    await page.waitForTimeout(150);
    const frameBase3 = state.frames.length;
    await page.mouse.up();
    await page.getByTestId('chat-input').waitFor({ timeout: 8000 }).catch(() => {});
    const typesKbd = state.frames.slice(frameBase3).filter((f) => f && typeof f.type === 'string').map((f) => f.type);
    check('⑤ ↑ 릴리스 실행 로그: audio.cancel + 키보드(B) 개방', typesKbd.includes('audio.cancel') && await page.getByTestId('chat-input').isVisible(), typesKbd.join(','));

    // 릴리스 정리
    await page.waitForTimeout(200);

    // ── ⑥ t_55e92e7e 실행 배선: ↓ 사진첨부 / ↗ 파일첨부 = 라벨의 '놓으면 실행'을 참으로 ──
    // ⑤ ↑가 B계층(키보드)을 열어두었으므로 A계층 복귀 후 진행 (마이크 버튼 = chat-voice-back).
    await page.getByTestId('chat-voice-back').click({ timeout: 5000 }).catch(() => {});
    await page.getByTestId('voice-stage-pad').waitFor({ timeout: 5000 });
    const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    // ⑥-a ↓ 릴리스 = 사진 첨부 스테이지 실행 (attachPhoto 재사용 — 파일 선택기 실오픈)
    {
      const pad6 = await page.getByTestId('voice-stage-pad').boundingBox();
      const x6 = pad6.x + pad6.width / 2, y6 = pad6.y + pad6.height / 2;
      await page.mouse.move(x6, y6);
      await page.mouse.down();
      await page.mouse.move(x6, y6 + 40, { steps: 4 }); // ↓ = photo
      const armPhoto = await page.getByTestId('compass-label-photo').count();
      const chooserP = page.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null);
      await page.mouse.up();
      const chooser = await chooserP;
      check('⑥ ↓ arm 배너 노출+릴리스 = 파일선택기 실행(사진첨부 배선)', armPhoto === 1 && !!chooser, `arm=${armPhoto} chooser=${!!chooser}`);
      if (chooser) {
        await chooser.setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG_1PX });
        await page.getByTestId('photo-editor').waitFor({ timeout: 8000 }).catch(() => {});
        const editorOpen = await page.getByTestId('photo-editor').isVisible().catch(() => false);
        const uploadCount = (stub.count || 0);
        check('⑥ ↓ 선택 → 업로드 POST + 사진 편집기 오픈 (칩 경로 단일 소스)', editorOpen && uploadCount >= 1, `editor=${editorOpen} uploads=${uploadCount}`);
        await page.getByTestId('photo-editor-close').click().catch(() => {});
        await page.waitForTimeout(200);
      }
    }
    // ⑥-b ↗ 릴리스 = 파일 첨부 (pickFilesWeb → att.add → 칩 + upload POST; 편집기 미해 = 원본 첨부)
    {
      const pad7 = await page.getByTestId('voice-stage-pad').boundingBox();
      const x7 = pad7.x + pad7.width / 2, y7 = pad7.y + pad7.height / 2;
      const uploadsBefore = stub.count || 0;
      await page.mouse.move(x7, y7);
      await page.mouse.down();
      await page.mouse.move(x7 + 23, y7 - 33, { steps: 4 }); // ↗ = file
      const armFile = await page.getByTestId('compass-label-file').count();
      const chooserP2 = page.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null);
      await page.mouse.up();
      const chooser2 = await chooserP2;
      check('⑥ ↗ arm 배너 노출+릴리스 = 파일선택기 실행(파일첨부 배선)', armFile === 1 && !!chooser2, `arm=${armFile} chooser=${!!chooser2}`);
      if (chooser2) {
        await chooser2.setFiles({ name: 'report.txt', mimeType: 'text/plain', buffer: Buffer.from('joystick file attach e2e') });
        await page.getByTestId('attachment-stage').waitFor({ timeout: 8000 }).catch(() => {});
        const chip = await page.getByTestId('attachment-stage').isVisible().catch(() => false);
        // 업로드는 att.add 후 비동기(blob fetch→POST /api/upload) — 카드 동기 읽기 레이스 방지: 카운터 증분 폴링
        let uploads = 0;
        for (let i = 0; i < 40; i++) {
          uploads = (stub.count || 0) - uploadsBefore;
          if (uploads >= 1) break;
          await page.waitForTimeout(100);
        }
        // 파일 = 편집기 미오픈 계약 (attachFile은 att.add만)
        const editorAfter = await page.getByTestId('photo-editor').isVisible().catch(() => false);
        check('⑥ ↗ 선택 → 첨부 칩 + upload POST·편집기 미오픈', chip && uploads >= 1 && !editorAfter, `chip=${chip} uploads=${uploads} editor=${editorAfter}`);
        await page.screenshot({ path: path.join(ART, '06-file-attach.png') }).catch(() => {});
      }
    }
    // ⑥-c 회귀: ← 릴리스 = cancel (첨부 스테이지 실행 없음 — 칩 수 불변)
    {
      const pad8 = await page.getByTestId('voice-stage-pad').boundingBox();
      const x8 = pad8.x + pad8.width / 2, y8 = pad8.y + pad8.height / 2;
      const chipsBefore = await page.evaluate(() => document.querySelectorAll('[data-testid^="stage-att-"]').length); // 칩 프레임만 (업로딩 배지 변천 제외)
      await page.mouse.move(x8, y8);
      await page.mouse.down();
      await page.mouse.move(x8 - 40, y8, { steps: 4 }); // ← = cancel
      await page.mouse.up();
      await page.waitForTimeout(400);
      const chipsAfter = await page.evaluate(() => document.querySelectorAll('[data-testid^="stage-att-"]').length);
      check('⑥-c ← 회귀 = cancel 실행 (첨부 실행 없음·칩 수 불변)', chipsAfter === chipsBefore, `${chipsBefore}->${chipsAfter}`);
    }
    // ⑥-d t_616e9abf → 편집 배선 전환: 릴리스 = audio.end{draft:true} 단독 —
    //   무draft audio.end 병행(위장전송) 금지 + transcript.draft 회신 전문이 입력창에 채워지고
    //   B 계층 개방. user 행 영속 0(전송 경로 아님) — message-user 수 불변으로 잠금.
    {
      const pad9 = await page.getByTestId('voice-stage-pad').boundingBox();
      const x9 = pad9.x + pad9.width / 2, y9 = pad9.y + pad9.height / 2;
      const usersBefore = await page.getByTestId('message-user').count();
      await page.mouse.move(x9, y9);
      await page.mouse.down();
      await page.mouse.move(x9 + 40, y9, { steps: 4 }); // → = edit
      await page.waitForTimeout(150);
      const armEdit = await page.getByTestId('compass-label-edit').count();
      const frameBase9 = state.frames.length;
      await page.mouse.up();
      await page.waitForTimeout(400);
      const rel9 = state.frames.slice(frameBase9).filter((f) => f && typeof f.type === 'string');
      const endFrames = rel9.filter((f) => f.type === 'audio.end');
      check('⑥-d → arm 배너 노출(배선 참)', armEdit === 1, `arm=${armEdit}`);
      check('⑥-d → 릴리스 = audio.end{draft:true} 단독 — cancel/무draft 없음', endFrames.length === 1 && endFrames[0].draft === true && !rel9.some((f) => f.type === 'audio.cancel'), rel9.map((f) => JSON.stringify(f)).join(','));
      // 백엔드(t_8bac5645) 회신 목킹: transcript.draft 전문 → 입력창 채움 + B 계층 자동 개방
      const DRAFT_TEXT = '수정할 음성 전사 문장';
      await state.sockets[state.sockets.length - 1].send(JSON.stringify({ type: 'transcript.draft', session_id: 'source', text: DRAFT_TEXT, confidence: 0.9, language: 'ko', duration_ms: 2100 }));
      await page.waitForTimeout(500);
      const draftValue = await page.evaluate(() => { const el = document.querySelector('[data-testid="chat-input"]'); return el ? String(el.value) : null; });
      check('⑥-d transcript.draft 회신 = 입력창 채움+B 개방 (전송 아님)', draftValue === DRAFT_TEXT, `value=${JSON.stringify(draftValue)}`);
      const usersAfter = await page.getByTestId('message-user').count();
      check('⑥-d user 행 영속 0 (message-user 수 불변)', usersAfter === usersBefore, `${usersBefore}->${usersAfter}`);
    }

    // ③ selectAction 단위 로직 검증 — 브라우저에서 모듈 로드 불가하므로 스킵
    // (실제 단위테스트는 별도 mocha/jest로)

    check('Z 런타임 오류 0', errs.length === 0, errs.join('; '));

    await ctx.close();

    // 결과 출력
    const pass = results.filter((r) => r.pass).length;
    const fail = results.filter((r) => !r.pass).length;
    console.log(`\n== compass t_08d671a8: ${pass} PASS / ${fail} FAIL ==`);
    process.exit(fail > 0 ? 1 : 0);
  } finally {
    await browser.close();
  }
})();

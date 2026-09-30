// t_45256c7a 라이브 게이트 — 나라 스펠러 신엔드로 대표님 원문 '이해오'류 pre/post 실측.
// t_f5a9b570 보강: 고유명사 보호 회귀 assertion — '김비서'→'김 비서' 과교정 차단 실측.
// 단위 테스트가 아닌 수동 검증 스크립트 (9/30 실행: 2문장 5+2건 교정 확인).
// 사용: cd apps/backend && NARA_SPELLER_ENABLED=true node_modules/.bin/tsx tests/live_ortho_gate.mts
import { applyNaraSpeller, protectedTermRanges } from '../src/lib/koreanOrthography';

const PRE = [
  '김비서 이해오 했으니 보고서 정리해드릴게요. 이해오 한 범위가 맞는지 확인부탁드려요.',
  '프로젝트 일정을 검토하고 결과물 보내드릴께요. 이해오 되는 범위에서 도와드릴게요.',
];
let fail = 0;
for (const text of PRE) {
  const r = await applyNaraSpeller(text);
  console.log('--- PRE  :', text);
  console.log('    POST :', r ? r.text : text, r ? '' : '(무오류 또는 실패=원문)');
  if (r) console.log('    COUNT:', r.suggestions.length, 'SKIPPED-PROTECTED:', r.skippedProtected, 'ITEMS:', r.suggestions.map(s => `${s.text}→${s.candidates[0]}`).join(' | '));
  // t_f5a9b570 (#454 실측 회귀): 원문에 '김비서'가 있으면 교정본에서도 원형 유지(분리 금지)
  if (text.includes('김비서')) {
    const out = r ? r.text : text;
    if (!out.includes('김비서') || out.includes('김 비서')) { console.error('    !! 고유명사 과교정 재발: 김비서 보호 실패'); fail++; }
    else console.log('    OK   : 김비서 원형 유지');
  }
}
// 오프셋 계산 자체의 네트워크 무관 점검
const n = protectedTermRanges('김비서에게 김비서 호출', ['김비서']).length;
console.log('RANGES : 김비서 x2 expected, got', n);
if (n !== 2) fail++;
if (fail) { console.error('LIVE GATE FAIL:', fail); process.exit(1); }
console.log('LIVE GATE PASS (고유명사 보호 포함)');

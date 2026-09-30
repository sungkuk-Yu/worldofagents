// t_45256c7a 라이브 게이트 — 나라 스펠러 신엔드로 대표님 원문 '이해오'류 pre/post 실측.
// 단위 테스트가 아닌 수동 검증 스크립트 (9/30 실행: 2문장 5+2건 교정 확인).
// 사용: cd apps/backend && NARA_SPELLER_ENABLED=true node_modules/.bin/tsx tests/live_ortho_gate.mts
import { applyNaraSpeller } from '../src/lib/koreanOrthography';

const PRE = [
  '김비서 이해오 했으니 보고서 정리해드릴게요. 이해오 한 범위가 맞는지 확인부탁드려요.',
  '프로젝트 일정을 검토하고 결과물 보내드릴께요. 이해오 되는 범위에서 도와드릴게요.',
];
for (const text of PRE) {
  const r = await applyNaraSpeller(text);
  console.log('--- PRE  :', text);
  console.log('    POST :', r ? r.text : text, r ? '' : '(무오류 또는 실패=원문)');
  if (r) console.log('    COUNT:', r.suggestions.length, 'ITEMS:', r.suggestions.map(s => `${s.text}→${s.candidates[0]}`).join(' | '));
}

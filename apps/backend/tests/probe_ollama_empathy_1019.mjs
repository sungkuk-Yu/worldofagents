#!/usr/bin/env node
/**
 * 로컬 ollama empathy 실측 게이트 (t_82cc0d99)
 * 
 * 대구(empathy) 첫 글자 출력 ≤ 300ms 로컬 확인
 * ollama(qwen2.5:3b) vs cloud flash 비교
 */

import { generateEmpathyRequest } from '../dist/lib/empathyRequest.js';

const testCases = [
  { msg: '내가 너 지금 누구랑 연결되어 있어?', template: 'eq_confirm' },
  { msg: '이거 해줘', template: 'eq_proceed' },
  { msg: '오늘 날씨 어때?', template: 'eq_understand' },
];

console.log('=== 로컬 ollama empathy 실측 게이트 ===\n');

for (const { msg, template } of testCases) {
  console.log(`발화: ${msg}`);
  const start = Date.now();
  
  try {
    const result = await generateEmpathyRequest(msg, template, 'ko');
    const durationMs = Date.now() - start;
    
    console.log(`  결과: ${result || '(null - 규칙 폴백)'}`);
    console.log(`  시간: ${durationMs}ms`);
    
    if (result && durationMs > 300) {
      console.log(`  ⚠️ WARNING: 300ms 게이트 실패 (${durationMs}ms)`);
    } else if (result) {
      console.log(`  ✓ 게이트 통과 (<300ms)`);
    }
  } catch (err) {
    console.log(`  ✗ 에러: ${err.message}`);
  }
  
  console.log('');
}

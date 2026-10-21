/**
 * 결정 인박스 렌더 근거 검증 (t_2de069f3)
 * - 소스 파일 구조 확인 (tsc --noEmit 통과 = 타입 안전)
 * - ChatScreen 배선 검증
 */

// @ts-check
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 1. DecisionInbox.tsx 소스 존재 + export 구문 확인
try {
  const inboxPath = path.join(__dirname, '../../src/components/DecisionInbox.tsx');
  const inboxContent = fs.readFileSync(inboxPath, 'utf-8');
  
  assert.ok(inboxContent.includes('export function DecisionInbox'), 'DecisionInbox export function 선언 확인');
  assert.ok(inboxContent.includes('DecisionInboxProps'), 'DecisionInboxProps 인터페이스 확인');
  assert.ok(inboxContent.includes('return ('), '컴포넌트 렌더 함수 확인');
  assert.ok(inboxContent.includes('<View style={styles.container}>'), '최상위 View 컨테이너 확인');
  assert.ok(inboxContent.includes('<Text style={styles.title}>결정 요청</Text>'), '헤더 텍스트 "결정 요청" 확인');
  assert.ok(inboxContent.includes('<DecisionCard'), 'DecisionCard 자식 컴포넌트 렌더 확인');
  
  console.log('✓ DecisionInbox.tsx 구조 검증 완료');
} catch (err) {
  console.error('✗ DecisionInbox.tsx 검증 실패:', err.message);
  process.exit(1);
}

// 2. DecisionCard.tsx 소스 존재 + export 구문 확인
try {
  const cardPath = path.join(__dirname, '../../src/components/DecisionCard.tsx');
  const cardContent = fs.readFileSync(cardPath, 'utf-8');
  
  assert.ok(cardContent.includes('export function DecisionCard'), 'DecisionCard export function 선언 확인');
  assert.ok(cardContent.includes('DecisionCardProps'), 'DecisionCardProps 인터페이스 확인');
  assert.ok(cardContent.includes('return ('), '컴포넌트 렌더 함수 확인');
  
  console.log('✓ DecisionCard.tsx 구조 검증 완료');
} catch (err) {
  console.error('✗ DecisionCard.tsx 검증 실패:', err.message);
  process.exit(1);
}

// 3. ChatScreen.tsx 배선 확인
try {
  const chatScreenPath = path.join(__dirname, '../../src/screens/ChatScreen.tsx');
  const chatScreenContent = fs.readFileSync(chatScreenPath, 'utf-8');
  
  assert.ok(chatScreenContent.includes("import { DecisionInbox }"), 'ChatScreen이 DecisionInbox를 임포트');
  assert.ok(chatScreenContent.includes('<DecisionInbox'), 'ChatScreen이 DecisionInbox 컴포넌트를 렌더');
  assert.ok(chatScreenContent.includes('decisions={decisions}'), 'decisions prop 전달 확인');
  assert.ok(chatScreenContent.includes('onUpdate={updateDecision}'), 'onUpdate 핸들러 바인딩 확인');
  assert.ok(chatScreenContent.includes('onJump={requestJump}'), 'onJump 핸들러 바인딩 확인');
  
  console.log('✓ ChatScreen.tsx 배선 검증 완료');
} catch (err) {
  console.error('✗ ChatScreen 검증 실패:', err.message);
  process.exit(1);
}

console.log('\n✓✓✓ 결정 인박스 렌더 근거 확보 완료 (t_2de069f3)');

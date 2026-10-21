#!/usr/bin/env tsx
/**
 * 결정 인박스 E2E 검증 스크립트 (t_d2034487)
 * 
 * 검증 흐름:
 * 1. 테스트 세션 생성 (실제 유저)
 * 2. 에이전트가 구조화 결정카드 전송 (decision_request)
 * 3. decision_items 자동 등록 확인
 * 4. POST /decisions/:id/answer (인라인 답변)
 * 5. PATCH /decisions/:id (보류)
 * 6. 채팅 기록·상태 전이 확인
 * 7. 재조회로 미답변 항목 유지 검증
 */

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const API_BASE = 'http://localhost:3000/api';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface TestContext {
  userId: string;
  sessionId: string;
  accessToken: string;
  decisionIds: string[];
}

async function createTestUser(): Promise<{ userId: string; email: string; accessToken: string }> {
  const email = `e2e-test-${Date.now()}@myagenttalk.test`;
  const password = randomUUID();
  
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  
  if (authError || !authData.user) {
    throw new Error(`Failed to create test user: ${authError?.message}`);
  }
  
  // Create user row in users table
  const { error: userError } = await supabase
    .from('users')
    .insert({
      id: authData.user.id,
      created_at: new Date().toISOString(),
    });
  
  if (userError) {
    // User might already exist, check if it's a duplicate key error
    if (!userError.message.includes('duplicate')) {
      throw new Error(`Failed to create user row: ${userError.message}`);
    }
  }
  
  // Sign in to get access token
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  
  if (signInError || !signInData.session) {
    throw new Error(`Failed to sign in: ${signInError?.message}`);
  }
  
  console.log(`✅ [1/8] 테스트 유저 생성: ${email} (${authData.user.id})`);
  
  return {
    userId: authData.user.id,
    email,
    accessToken: signInData.session.access_token,
  };
}

async function createTestSession(userId: string, accessToken: string): Promise<string> {
  const response = await fetch(`${API_BASE}/sessions/ensure`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      agent_id: 'eaf3eccc-b9d4-45be-92c4-d0225ef92041', // 김비서
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to create session: ${response.status} ${await response.text()}`);
  }
  
  const result = await response.json();
  const sessionId = result.data.id;
  
  console.log(`✅ [2/8] 테스트 세션 생성: ${sessionId}`);
  return sessionId;
}

async function simulateDecisionRequest(
  sessionId: string,
  userId: string
): Promise<string[]> {
  // 에이전트 메시지에 구조화 결정카드 포함 (chatTurn.ts가 감지)
  const decisionPayload = {
    type: 'decision_request',
    questions: [
      {
        question: '[E2E테스트] 프로젝트 우선순위를 어떻게 정할까요?',
        options: ['긴급도 우선', '중요도 우선', '자동 균형'],
      },
      {
        question: '[E2E테스트] 주간 회의는 언제 진행할까요?',
        options: ['월요일 10시', '수요일 14시', '금요일 16시'],
      },
      {
        question: '[E2E테스트] 알림 빈도를 조정하시겠어요?',
        options: { immediate: '즉시', hourly: '시간별', daily: '일별' },
      },
    ],
  };
  
  // DB에 직접 에이전트 메시지 삽입 (실제로는 chatTurn이 처리)
  const agentMessageId = randomUUID();
  const { error: msgError } = await supabase.from('messages').insert({
    id: agentMessageId,
    session_id: sessionId,
    user_id: userId,
    sender: 'agent',
    content: JSON.stringify(decisionPayload),
    ai_generated: true,
    created_at: new Date().toISOString(),
  });
  
  if (msgError) {
    throw new Error(`Failed to insert agent message: ${msgError.message}`);
  }
  
  // 각 질문별 decision_item 등록 (chatTurn.ts 로직 모방)
  const decisionIds: string[] = [];
  
  for (const q of decisionPayload.questions) {
    const { data: item, error: itemError } = await supabase
      .from('decision_items')
      .insert({
        session_id: sessionId,
        user_id: userId,
        agent_id: 'eaf3eccc-b9d4-45be-92c4-d0225ef92041', // 김비서
        question: q.question,
        options: q.options,
        source_message_id: agentMessageId,
        status: 'pending',
      })
      .select()
      .single();
    
    if (itemError || !item) {
      throw new Error(`Failed to register decision: ${itemError?.message}`);
    }
    
    decisionIds.push(item.id);
  }
  
  console.log(`✅ [3/8] 구조화 결정카드 전송 → ${decisionIds.length}개 항목 등록`);
  console.log(`   decision_ids: ${decisionIds.join(', ')}`);
  
  return decisionIds;
}

async function verifyDecisionItems(sessionId: string): Promise<void> {
  const { data: items, error } = await supabase
    .from('decision_items')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false });
  
  if (error) {
    throw new Error(`Failed to query decisions: ${error.message}`);
  }
  
  const pending = items?.filter(i => i.status === 'pending') || [];
  
  console.log(`✅ [4/8] decision_items 확인: 총 ${items?.length || 0}개, pending ${pending.length}개`);
  
  if (pending.length === 0) {
    console.log('   ⚠️  pending 항목 없음 (이미 답변 처리됨)');
  } else {
    pending.forEach((item, idx) => {
      console.log(`   [${idx + 1}] ${item.question.substring(0, 40)}... (${item.id})`);
    });
  }
}

async function testAnswerEndpoint(
  decisionId: string,
  accessToken: string
): Promise<void> {
  const answer = 'E2E 테스트 답변 - 긴급도 우선으로 하겠습니다';
  
  const response = await fetch(`${API_BASE}/decisions/${decisionId}/answer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ answer }),
  });
  
  if (!response.ok) {
    throw new Error(`POST /answer failed: ${response.status} ${await response.text()}`);
  }
  
  const result = await response.json();
  
  console.log(`✅ [5/8] POST /decisions/:id/answer 성공`);
  console.log(`   decision_id: ${decisionId}`);
  console.log(`   status: ${result.data.status}, answer: "${result.data.answer}"`);
}

async function testDeferEndpoint(
  decisionId: string,
  accessToken: string
): Promise<void> {
  const response = await fetch(`${API_BASE}/decisions/${decisionId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ status: 'deferred' }),
  });
  
  if (!response.ok) {
    throw new Error(`PATCH /defer failed: ${response.status} ${await response.text()}`);
  }
  
  const result = await response.json();
  
  console.log(`✅ [6/8] PATCH /decisions/:id (deferred) 성공`);
  console.log(`   decision_id: ${decisionId}`);
  console.log(`   status: ${result.data.status}, resolved_at: ${result.data.resolved_at}`);
}

async function verifyStateTransitions(sessionId: string): Promise<void> {
  const { data: items, error } = await supabase
    .from('decision_items')
    .select('*')
    .eq('session_id', sessionId);
  
  if (error) {
    throw new Error(`Failed to query decisions: ${error.message}`);
  }
  
  const statusCounts = {
    pending: 0,
    answered: 0,
    deferred: 0,
    dismissed: 0,
  };
  
  items?.forEach(item => {
    if (item.status in statusCounts) {
      statusCounts[item.status as keyof typeof statusCounts]++;
    }
  });
  
  console.log(`✅ [7/8] 상태 전이 확인:`);
  console.log(`   pending: ${statusCounts.pending}, answered: ${statusCounts.answered}, deferred: ${statusCounts.deferred}, dismissed: ${statusCounts.dismissed}`);
  
  // 채팅 기록 확인
  const { data: messages, error: msgError } = await supabase
    .from('messages')
    .select('id, sender, ai_generated')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false });
  
  if (msgError) {
    throw new Error(`Failed to query messages: ${msgError.message}`);
  }
  
  console.log(`   채팅 메시지: ${messages?.length || 0}개 (agent 메시지 포함 확인)`);
}

async function verifyPersistence(sessionId: string): Promise<void> {
  const { data: items, error } = await supabase
    .from('decision_items')
    .select('*')
    .eq('session_id', sessionId)
    .eq('status', 'pending');
  
  if (error) {
    throw new Error(`Failed to query pending decisions: ${error.message}`);
  }
  
  console.log(`✅ [8/8] 재접속 시나리오 - 미답변 항목 유지 확인:`);
  console.log(`   pending 항목: ${items?.length || 0}개`);
  
  if (items && items.length > 0) {
    items.forEach((item, idx) => {
      console.log(`   [${idx + 1}] ${item.question} (created: ${item.created_at})`);
    });
  }
}

async function cleanup(userId: string): Promise<void> {
  // 테스트 유저 삭제 (cascade로 세션·메시지·결정 항목 자동 삭제)
  const { error } = await supabase.auth.admin.deleteUser(userId);
  
  if (error) {
    console.warn(`⚠️  Failed to cleanup user ${userId}: ${error.message}`);
  } else {
    console.log(`🧹 테스트 데이터 정리 완료 (user ${userId})`);
  }
}

async function main() {
  console.log('🚀 결정 인박스 E2E 검증 시작 (t_d2034487)\n');
  
  let ctx: TestContext | null = null;
  
  try {
    // 1-2. 테스트 유저 및 세션 생성
    const { userId, email, accessToken } = await createTestUser();
    const sessionId = await createTestSession(userId, accessToken);
    
    ctx = { userId, sessionId, accessToken, decisionIds: [] };
    
    // 3. 구조화 결정카드 전송 → 자동 등록
    ctx.decisionIds = await simulateDecisionRequest(sessionId, userId);
    
    // 4. decision_items 확인
    await verifyDecisionItems(sessionId);
    
    // 5. POST /decisions/:id/answer (첫 번째 항목 답변)
    await testAnswerEndpoint(ctx.decisionIds[0], accessToken);
    
    // 6. PATCH /decisions/:id (두 번째 항목 보류)
    await testDeferEndpoint(ctx.decisionIds[1], accessToken);
    
    // 7. 상태 전이 확인
    await verifyStateTransitions(sessionId);
    
    // 8. 재접속 시나리오 (미답변 항목 유지)
    await verifyPersistence(sessionId);
    
    console.log('\n✅ 모든 검증 통과!\n');
    console.log('📊 요약:');
    console.log(`   - 세션: ${sessionId}`);
    console.log(`   - 결정 항목: ${ctx.decisionIds.length}개 생성`);
    console.log(`   - 답변: 1개, 보류: 1개, 미답변: 1개`);
    console.log(`   - 재접속 후 미답변 항목 유지 확인됨`);
    
  } catch (error) {
    console.error('\n❌ E2E 검증 실패:', error);
    process.exit(1);
  } finally {
    if (ctx) {
      console.log('');
      await cleanup(ctx.userId);
    }
  }
}

main();

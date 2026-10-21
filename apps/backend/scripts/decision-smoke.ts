/** 결정 인박스 화면 실측용 — 실DB에 pending 카드 1건 등록 (registerDecision 실흐름) */
import { supabaseAdmin } from '../src/lib/supabase';
import { registerDecision } from '../src/lib/decisionItems';

async function main() {
  // 1) decision_items 테이블 존재 확인
  const probe = await supabaseAdmin.from('decision_items').select('id').limit(1);
  if (probe.error) {
    console.log('TABLE_PROBE_FAIL:', JSON.stringify(probe.error).slice(0, 300));
    process.exit(2);
  }
  console.log('TABLE_OK');

  // 2) 최근 세션 1건 (user_id 포함)
  const s = await supabaseAdmin
    .from('sessions')
    .select('id, user_id, agent_id, last_activity_at')
    .order('last_activity_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (s.error || !s.data) {
    console.log('SESSION_FAIL:', JSON.stringify(s.error || 'no session').slice(0, 300));
    process.exit(3);
  }
  const { id: sessionId, user_id: userId, agent_id: agentId } = s.data as any;
  console.log('SESSION_OK', sessionId);

  // 3) pending 카드 등록
  const item = await registerDecision(
    supabaseAdmin,
    sessionId,
    userId,
    agentId || '',
    '결정 인박스 화면 실측 — 이 카드가 채팅 옆 패널에 보이면 프론트 연동 성공입니다. 실측 후 답변 또는 보류해 주세요.',
    ['확인(패널 보임)', '안 보임(피드백)']
  );
  console.log('INSERTED:', item.id, item.status);
}

main().catch((e) => { console.log('ERR:', String(e).slice(0, 300)); process.exit(1); });

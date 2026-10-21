/** 결정 인박스 헬퍼 (t_6d208fb5) */
import { DbClient } from './supabase';

export interface DecisionItem {
  id: string;
  session_id: string;
  user_id: string;
  source_message_id: string | null;
  agent_id: string;
  question: string;
  options: string[] | Record<string, unknown>;
  status: 'pending' | 'answered' | 'deferred' | 'dismissed';
  answer: string | null;
  created_at: string;
  resolved_at: string | null;
}

/** 세션의 모든 결정 항목 조회 (상태별 필터 옵션) */
export async function listDecisions(
  db: DbClient,
  sessionId: string,
  status?: 'pending' | 'answered' | 'deferred' | 'dismissed'
): Promise<DecisionItem[]> {
  let query = db
    .from('decision_items')
    .select('*')
    .eq('session_id', sessionId);
  
  if (status) {
    query = query.eq('status', status);
  }
  
  query = query.order('created_at', { ascending: false });
  
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as DecisionItem[];
}

/** 결정 스냅샷 (WS 브로드캐스트용) */
export interface DecisionSnapshot {
  pending_count: number;
  items: Array<{
    id: string;
    question: string;
    options: string[] | Record<string, unknown>;
    status: string;
    created_at: string;
  }>;
}

export function decisionSnapshot(items: DecisionItem[]): DecisionSnapshot {
  const pending = items.filter(i => i.status === 'pending');
  return {
    pending_count: pending.length,
    items: items.map(i => ({
      id: i.id,
      question: i.question,
      options: i.options,
      status: i.status,
      created_at: i.created_at,
    })),
  };
}

/** 구조화 결정카드 등록 (메시지 POST 자동 등록용) */
export async function registerDecision(
  db: DbClient,
  sessionId: string,
  userId: string,
  agentId: string,
  question: string,
  options: string[] | Record<string, unknown>,
  sourceMessageId?: string
): Promise<DecisionItem> {
  const { data, error } = await db
    .from('decision_items')
    .insert({
      session_id: sessionId,
      user_id: userId,
      agent_id: agentId,
      question,
      options: options as any,
      source_message_id: sourceMessageId || null,
      status: 'pending',
    })
    .select()
    .single();
  
  if (error || !data) throw error || new Error('결정 항목 등록 실패');
  return data as DecisionItem;
}

/** 결정 상태 전이 (answered/deferred/dismissed) */
export async function updateDecisionStatus(
  db: DbClient,
  decisionId: string,
  status: 'answered' | 'deferred' | 'dismissed',
  answer?: string
): Promise<DecisionItem> {
  const update: Record<string, unknown> = {
    status,
    resolved_at: new Date().toISOString(),
  };
  
  if (status === 'answered' && answer) {
    update.answer = answer;
  }
  
  const { data, error } = await db
    .from('decision_items')
    .update(update)
    .eq('id', decisionId)
    .select()
    .single();
  
  if (error || !data) throw error || new Error('결정 상태 갱신 실패');
  return data as DecisionItem;
}

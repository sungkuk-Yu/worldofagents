/**
 * mock STT 오염 메타 교정 감사 (t_5cba9ebb 3항, 대표님 9/29).
 *
 * 배경: 사이드카 연결 전 DEV/mock 경로가 발화 없이 전사 고정 문장
 *   "안녕하세요, 오늘 할 일을 정리해 주세요." (stt.ts MOCK_STT_PHRASE, service='mock')
 *   을 user 행으로 실DB에 영속시켰다. 그 결과 세션 제목(mock 문장 파생)과
 *   후속 질문 칩(mock 발화 기반 생성)이 오염됐다.
 *
 * 원칙 (대표님): **삭제 금지 — 발화 기록 보존, 메타 교정만.**
 *   ① 식별: messages WHERE role='user' AND content=MOCK_STT_PHRASE
 *      AND stt_metadata->>'service'='mock'
 *   ② 그 문장이 세션의 첫 user 발화이고 session.title이 mock 파생이면 →
 *      같은 세션의 첫 실발화(비-mock user 행)로 제목 재재생성 (deriveSessionTitle).
 *      실발화가 아직 없으면 title을 NULL로 되돌려 목록 폴백(에이전트명)으로 강등.
 *   ③ mock user 행이 만든 답변 행의 structured_payload.suggested_questions는
 *      mock 문맥 기반이므로 제거 대상으로 목록화 (--fix에서 빈 배열로 교정).
 *   ④ 교정 대상 user 행 자체에는 structured_payload.mock_polluted=true만 얹는다
 *      (content/turn_index 불변 — 원본 기록 보존).
 *
 * 실행 (apps/backend):
 *   목록만(읽기 전용, 기본):  DEV_MODE=false ./node_modules/.bin/tsx scripts/audit_mock_pollution.ts
 *   교정 반영:               DEV_MODE=false ./node_modules/.bin/tsx scripts/audit_mock_pollution.ts --fix
 * 실DB(--fix) 반영은 김비서→대표님 승인 게이트 후 수행 (010 관례).
 */
import { supabaseAdmin } from '../src/lib/supabase';
import { MOCK_STT_PHRASE } from '../src/lib/stt';
import { deriveSessionTitle } from '../src/lib/sessionTitle';

const FIX = process.argv.includes('--fix');

interface MsgRow {
  id: string; session_id: string; turn_index: number; role: string;
  content: string; source_neuron: string | null;
  stt_metadata: Record<string, unknown> | null;
  structured_payload: Record<string, unknown> | null;
}

async function main() {
  console.log(`=== mock 오염 감사 — 고정문장: "${MOCK_STT_PHRASE}" (${FIX ? 'FIX' : 'DRY-RUN'}) ===\n`);

  // ① mock user 행 식별
  const { data: mockRows, error } = await supabaseAdmin
    .from('messages')
    .select('id,session_id,turn_index,role,content,source_neuron,stt_metadata,structured_payload')
    .eq('role', 'user')
    .eq('content', MOCK_STT_PHRASE)
    .order('session_id')
    .order('turn_index');
  if (error) { console.error('조회 실패:', error.message); process.exit(1); }
  // service 표기가 없는 구(舊) mock 행도 content 동일이면 포함하되, 실전사(local/openai)와
  // 문장이 우연히 일치하는 행을 막기 위해 표기 있는 행은 service='mock'만 인정.
  const polluted = (mockRows as MsgRow[] || []).filter(m => {
    const svc = m.stt_metadata?.service;
    return svc === undefined || svc === null || svc === 'mock';
  });
  console.log(`mock user 행: ${polluted.length}건 (content 일치 후보 ${(mockRows || []).length}건 중 service 표기 필터 통과)`);

  const bySession = new Map<string, MsgRow[]>();
  for (const m of polluted) {
    const list = bySession.get(m.session_id) || [];
    list.push(m);
    bySession.set(m.session_id, list);
  }

  const titleFixes: Array<{ session_id: string; from: string; to: string | null }> = [];
  const sqFixes: Array<{ message_id: string; session_id: string; before: unknown }> = [];
  const flagFixes: Array<{ message_id: string; session_id: string }> = [];

  for (const [sessionId, rows] of bySession) {
    rows.sort((a, b) => a.turn_index - b.turn_index);
    // ② 세션 제목: mock 파생 여부 판정 — title이 고정문장 파생(결정론 재계산)과 일치할 때만 교정
    const { data: session } = await supabaseAdmin.from('sessions')
      .select('id,title').eq('id', sessionId).maybeSingle();
    const title = (session as { title?: string | null } | null)?.title ?? null;
    const mockDerived = deriveSessionTitle(MOCK_STT_PHRASE);
    if (title && mockDerived && title === mockDerived) {
      const { data: later } = await supabaseAdmin.from('messages')
        .select('id,turn_index,role,content,stt_metadata,structured_payload')
        .eq('session_id', sessionId).eq('role', 'user')
        .neq('content', MOCK_STT_PHRASE)
        .order('turn_index').limit(1);
      const firstReal = (later as MsgRow[] | null)?.[0];
      const rederived = firstReal ? deriveSessionTitle(firstReal.content) : null;
      titleFixes.push({ session_id: sessionId, from: title, to: rederived });
      if (FIX) {
        await supabaseAdmin.from('sessions').update({ title: rederived }).eq('id', sessionId);
      }
    }
    // ① 발화 기록 보존 플래그 (②③의 근거 표식)
    for (const r of rows) {
      if (r.structured_payload?.mock_polluted !== true) {
        flagFixes.push({ message_id: r.id, session_id: sessionId });
        if (FIX) {
          await supabaseAdmin.from('messages')
            .update({ structured_payload: { ...(r.structured_payload || {}), mock_polluted: true } })
            .eq('id', r.id);
        }
      }
      // ③ 같은 턴(직후 answer 행)의 suggested_questions — mock 문맥 기반 칩 제거 대상
      // 같은 answer 행을 두 mock 발화가 공유하면(연속 재전송) 한 번만 적는다.
      const { data: answers } = await supabaseAdmin.from('messages')
        .select('id,session_id,turn_index,role,content,source_neuron,stt_metadata,structured_payload')
        .eq('session_id', sessionId).eq('role', 'agent').eq('source_neuron', 'answer')
        .gt('turn_index', r.turn_index).order('turn_index').limit(1);
      const ans = (answers as MsgRow[] | null)?.[0];
      const sq = ans?.structured_payload?.suggested_questions;
      if (Array.isArray(sq) && sq.length && !sqFixes.some(f => f.message_id === ans.id)) {
        sqFixes.push({ message_id: ans.id, session_id: sessionId, before: sq });
        if (FIX) {
          await supabaseAdmin.from('messages')
            .update({ structured_payload: { ...ans.structured_payload!, suggested_questions: [] } })
            .eq('id', ans.id);
        }
      }
    }
  }

  console.log(`\n[세션 제목 교정] ${titleFixes.length}건`);
  for (const t of titleFixes) console.log(`  ${t.session_id}: "${t.from}" -> ${t.to === null ? '(NULL — 목록 폴백)' : `"${t.to}"`}`);
  console.log(`\n[suggested_questions 제거] ${sqFixes.length}건`);
  for (const s of sqFixes) console.log(`  msg ${s.message_id} (${s.session_id}): ${JSON.stringify(s.before).slice(0, 120)}`);
  console.log(`\n[mock_polluted 플래그] ${flagFixes.length}건`);
  for (const f of flagFixes) console.log(`  msg ${f.message_id} (${f.session_id})`);
  if (!FIX) console.log('\nDRY-RUN — 반영은 --fix 재실행(승인 게이트 후).');
  else console.log('\nFIX 반영 완료. read-back:');
  if (FIX) {
    const { data: checkRows } = await supabaseAdmin.from('messages')
      .select('id,structured_payload').eq('role', 'user').eq('content', MOCK_STT_PHRASE).limit(200);
    const flagged = (checkRows || []).filter((m: MsgRow) => m.structured_payload?.mock_polluted === true).length;
    console.log(`  mock 행 ${checkRows?.length ?? 0} 중 플래그 ${flagged}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });

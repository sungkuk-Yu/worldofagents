import { config } from '../config';
import { Locale, PATIENCE_PLAN, patienceQuipAt, pickQuip, QuipKey } from './locale';
import { RelayCurtain, relayStageForEvent } from './relay';
import type { RelayStage } from './relay';
import { personaAckLine, personaLine, personaPatienceLine, queueJoinLine, PERSONA_SILENCE_FILL_MS, type PersonaLineSource } from './personaVoice';
import { registerRun, hasActiveRun } from '../websocket/eventlog';
import { randomUUID } from 'node:crypto';
import { DbClient } from './supabase';
import { assertAttachmentsOwned } from './attachments';
import { MessagesRow, SessionsRow } from '../types/db';
import { processTurn, TurnResult, NeuronStage, ProcessTurnOptions } from '../neurons/graph';
import { rowToPersonaConfig } from './persona';
import { ApiError } from './errors';
import { serializeMessage } from './helpers';
import { ServerMessage, NEURON_NAMES } from '../websocket/protocol';
import { listQueue, markQueueStatus, queueSnapshot, skipAllPending } from './questionQueue';
import { clientReqColumns, findExistingByClientReqId, isClientReqConflict, isMissingClientReqColumn, markIdempotencyColumnMissing, normalizeClientReqId } from './idempotency';
import { resolvePendingReplies, replyPendingSnapshot } from './awaitingReply';
import { deriveSessionTitle, sessionTitleOf, setSessionTitleIfEmpty } from './sessionTitle';
import type { JournalRow } from './runCheckpoint';

export type TurnEmitEvent = Extract<ServerMessage, { type: 'message.new' | 'run.started' | 'run.progress' | 'run.completed' | 'run.failed' | 'run.cancelled' | 'answer.delta' | 'answer.done' | 'neuron.status' | 'transcript.final' | 'queue.updated' | 'relay.updated' | 'reply.pending.updated' | 'persona.line' }>;

/** 단일 페르소나 보이스 채널 발행자 (t_5cba9ebb — 대표님 9/29 "여러 개의 동시 출력 창이
 *  제거 대상", 볼트 리서치 반영). 한 시점 한 줄 규칙의 백엔드 발화점:
 *  ack(접수 ≤2s) → relay stage 진행(content-bearing) → patience(4초+ 침묵 fill).
 *  answer.delta가 시작되면 kill() — 답변 첫 문장이 줄을 흡수하므로 이후 줄은 발화하지 않는다. */
export class PersonaVoice {
  private dead = false;
  private lastLine = '';
  constructor(
    private readonly emit: (e: TurnEmitEvent) => void,
    private readonly base: { session_id: string; run_id: string },
    private readonly locale: Locale,
  ) {}
  /** 답변 스트리밍 개시 = 이 줄의 수명 종료 (프론트 교체 애니메이션 없음 — 같은 사람 발화 연속). */
  kill(): void { this.dead = true; }
  get killed(): boolean { return this.dead; }
  /** 같은 문장 연속 재발송 금지 (한 시점 한 줄 — 노이즈 감소). */
  private say(source: PersonaLineSource, text: string): void {
    if (this.dead || !text.trim() || text === this.lastLine) return;
    this.lastLine = text;
    this.emit({ type: 'persona.line', ...this.base, line: text, source });
  }
  /** 접수 ack — run.started 직동 (첫 발화 ≤2s SLA). 롤 전환 무통보(Intercom Fin): 어떤 뉴런이 받는지 말하지 않는다. */
  ack(): void { this.say('ack', personaAckLine(this.locale)); }
  /** 릴레이 진행 → 페르소나 1인칭 content-bearing 줄. briefing(=ack 중복)·done(=answer 중복)은 생략. */
  stage(stage: RelayStage, pending = 0): void {
    if (stage === 'briefing' || stage === 'done') return;
    this.say('progress', personaLine(stage, this.locale, { pending }));
  }
  /** 발화 간 공백 fill (침묵 = 실패). 단 답변 스트리밍이 이미 시작된 뒤엔 침묵 허용(answer가 말 중). */
  patience(tick: number): void { this.say('progress', personaPatienceLine(tick, this.locale)); }
  /** busy 입력 합류 고지 (Claude Code/Open WebUI 관례 — 1인칭·감소하는 위치, 무정보 ETA 금지). */
  queueJoin(pending: number): void {
    this.say('queue', queueJoinLine(pending, this.locale));
  }
}


/** 텍스트 전송 턴의 멱등 재사용 결과 (t_3486b1d7 ①): 같은 client_req_id 재전송이 사전 조회로
 *  기존 user 행을 찾았을 때의 반환형. deduped=true면 턴을 실행하지 않았다(추가 이벤트 0건). */
export interface IdempotentTurnResult extends TurnResult {
  deduped: true;
}

/**
 * 전사 확정 발화의 user 행 선(先)영속 (t_2133e4fc, 대표님 #324 "질문은 텍스트로
 * 내가 뭘 질문했는지는 보여줬으면해") — handleTr가 runTextTurn 실행 **이전**에 이 함수로
 * user 메시지를 저장하고 transcript.final+message.new를 즉시 브로드캐스트한다.
 * LLM 실행이 37~300s 걸리거나 실패(run.failed)해도 발화 텍스트는 화면에 남는다(텔레그램처럼).
 * runTextTurn(persistedUser)이 같은 행을 재사용해 중복 영속하지 않는다 (ingress contract 유지).
 * 세션 제목 자동 채움도 여기서 선처리 — 실행 실패로도 목록 제목이 실전되지 않는다.
 *
 * 013 멱등 계약 존지 (t_3486b1d7, 재베이스 r2 통합 판정): clientReqId 공급 시
 *  · 사전 조회 — 같은 (session, client_req_id) user 행이 있으면 insert 없이 그 행을 반환(재전송 선방어)
 *  · clientReqColumns로 스탬프 — MESSAGE_IDEMPOTENCY_DISABLED/013 래치 시 컬럼 미접촉(강등 존지)
 *  · 013 미적용 실DB(PGRST204/42703) 직격 → markIdempotencyColumnMissing 후 컬럼 없이 1회 재시도
 *  · client_req 유니크 충돌(사전 조회를 뚫은 레이스)은 turn_index 리트라이로 삼키지 않고 CONFLICT
 *    (processTurn insert와 동일 사다리 — 선영속이 멱등을 우회하는 경로가 되지 않는다).
 *  · deduped=true(재전송이 사전 조회에 걸림)면 handleTr은 선방송을 건너뛰고 runTextTurn의
 *    deduped 경로(메시지 1건, 턴 미실행)에 위임한다 — 선영속이 재전송_duplicate_턴_실행_구멍이 되지 않는다.
 */
export interface EarlyUserResult {
  row: MessagesRow;
  /** 사전 조회로 기존 client_req_id 행을 재사용한 재전송이면 true (insert 0건). */
  deduped: boolean;
}

export async function persistUserUtteranceEarly(
  db: DbClient, session: SessionsRow, userId: string, content: string,
  opts: { locale?: Locale; sttMetadata?: Record<string, unknown> | null; clientReqId?: string | null } = {}
): Promise<EarlyUserResult> {
  if (session.user_id !== userId) throw new ApiError('FORBIDDEN', '세션 소유자만 메시지를 보낼 수 있습니다.');
  if (session.status === 'archived') throw new ApiError('SESSION_ARCHIVED', '아카이브된 세션입니다.');
  const locale = opts.locale ?? config.defaultLocale;
  // 정규화는 runTextTurn과 같은 단일 함수 — 사전 조회 키와 stamp 키가 반드시 일치한다.
  const clientReqId = normalizeClientReqId(opts.clientReqId ?? null);
  const prior = await findExistingByClientReqId(db, session.id, clientReqId);
  if (prior) return { row: prior, deduped: true }; // 재전송: 같은 user message_id (insert 0, 선방송 skip)
  if (!sessionTitleOf(session)) {
    const derived = deriveSessionTitle(content);
    if (derived) {
      session.title = derived; // runTextTurn의 재세팅 방지 가드와 같은 객체 변형 계약
      await setSessionTitleIfEmpty(db, session.id, derived).catch(() => undefined);
    }
  }
  const getNextTurn = async () => {
    const { data: lastMsg, error } = await db.from('messages').select('turn_index')
      .eq('session_id', session.id).order('turn_index', { ascending: false }).limit(1).maybeSingle();
    if (error) throw new ApiError('INTERNAL_ERROR', error.message);
    return ((lastMsg as { turn_index?: number } | null)?.turn_index ?? -1) + 1;
  };
  // processTurn saveUser 관례: clientReqColumns는 insert 시점에 재계산 — 래치 on 후
  // 재시도에서 컬럼이 실제 제외된다. 진입 시점 포착(userCols)은 래치 판정 가드용.
  const buildRow = (turn: number) => ({
    session_id: session.id,
    parent_message_id: null,
    root_message_id: null,
    turn_index: turn,
    role: 'user',
    locale,
    ai_generated: false,
    message_type: opts.sttMetadata ? 'voice' : 'text',
    content,
    dialogue_type: null,
    structured_payload: {},
    stt_metadata: opts.sttMetadata ?? null,
    source_neuron: null,
    attachments: [],
    persona_guard: {},
    user_feedback: null,
    ...clientReqColumns(clientReqId),
  });
  const userCols = clientReqColumns(clientReqId);
  let { data, error } = await db.from('messages').insert(buildRow(await getNextTurn())).select().single();
  // client_req 유니크 충돌 = 재전송 레이스 — turn_index 리트라이로 삼키면 중복 user 행 영속.
  if (error && isClientReqConflict(error)) throw new ApiError('CONFLICT', '중복 전송이 이미 접수되었습니다.');
  // 013 미적용 강등 사다리 (008/011 관례): 래치 후 컬럼 없이 1회 재시도.
  if (error && userCols.client_req_id !== undefined && isMissingClientReqColumn(error)) {
    markIdempotencyColumnMissing();
    ({ data, error } = await db.from('messages').insert(buildRow(await getNextTurn())).select().single());
  }
  // processTurn과 동일 강등: UNIQUE(session_id,turn_index) 레이스는 번호 재읽기로 1회 재시도.
  if (error && /duplicate|unique/i.test(String(error.message || ''))) {
    ({ data, error } = await db.from('messages').insert(buildRow(await getNextTurn())).select().single());
  }
  if (error || !data) throw new ApiError('INTERNAL_ERROR', error?.message || '사용자 메시지 저장 실패');
  return { row: data as MessagesRow, deduped: false };
}

/** REST와 WS가 공유하는 상태 전이 및 확정 메시지 발행 경계. */
export async function runTextTurn(
  db: DbClient, session: SessionsRow, userId: string, content: string,
  opts: { locale?: Locale; thread?: ProcessTurnOptions['thread']; sttMetadata?: Record<string, unknown> | null; attachmentIds?: string[]; replyToId?: unknown; answerLeadMs?: number; clientReqId?: string | null; emit: (e: TurnEmitEvent) => void;
    /** 선방송 run_id (t_2133e4fc): handleTr가 message.new에 이미 실은 run_id와 같아야 한다. */
    turnId?: string;
    /** 선영속 user 행 (t_2133e4fc): processTurn은 이를 재사용(중복 insert 금지)하고,
     *  history에서 이 id를 배제(자신이 직전 발화로 오인되는 repeatUtterance 오탐 방지)한다. */
    persistedUser?: MessagesRow;
    /** 내구성 실행 resume 시드 (t_7182aa8f③): 부팅 스캐너가 넘긴 graph_runs 행. */
    resume?: JournalRow }
): Promise<TurnResult | IdempotentTurnResult> {
  const locale = opts.locale ?? config.defaultLocale;
  // resume 실행은 크래시 전 run_id를 thread로 재사용해야 체크포인터/결정적 메시지 id가
  // 이어진다 (t_7182aa8f③). 선방송 run_id(t_2133e4fc)가 그다음, 일반 실행은 새 UUID.
  const turnId = opts.resume?.run_id || opts.turnId || randomUUID();
  const base = { session_id: session.id, run_id: turnId };
  // 단일 페르소나 보이스 채널 (t_5cba9ebb): 모든 연출 발화가 여기 한 줄로 수렴한다.
  const voice = new PersonaVoice(opts.emit, base, locale);
  // 4초+ 침묵 fill 타이머 (try 밖 선언 — finally에서 정리).
  let silenceFill: ReturnType<typeof setTimeout> | undefined;
  let completed = false;
  let processing = false;
  let lastStage: NeuronStage | undefined;
  let partialText = '';
  // 페르소나 말투(quip tone)가 로드되기 전 문구는 기본 warm으로 나간다.
  let personaTone: Record<string, unknown> | null = null;
  const quip = (key: QuipKey) => pickQuip(key, locale, personaTone);
  const abort = new AbortController();
  // 첨부 선검증 (t_401c5bd1): 소유권 없는 attachment_ids로 고아 user 메시지/LLM 비용이 남지 않게
  // 턴 저장·실행 전에 실패시킨다. WS message.send/REST sendMessage/replies 공통 경로.
  // resume는 진입 시점에 이미 검증·링크된 첨부 (assert가 '이미 연결됨'을 거부하므로 생략 —
  // processTurn의 링크 read-back 가드가 구간 재시작을 담당).
  if (!opts.resume && opts.attachmentIds?.length) await assertAttachmentsOwned(db, userId, opts.attachmentIds);
  const unregister = registerRun(session.id, { runId: turnId, abort, partial: () => partialText });
  let failure = { code: 'INTERNAL_ERROR', message: '턴 처리 중 오류가 발생했습니다.' };
  // 지연 진행도 티커: patienceMs 이후 "확인 중→거의 다 됨" 2회까지 이어 붙이고 그 뒤 정지한다.
  const startedAt = Date.now();
  let quipTick = 0;
  const patience = setInterval(() => {
    if (completed || Date.now() - startedAt < config.quipPatienceMs) return;
    const step = patienceQuipAt(quipTick);
    if (step) {
      lastStage = step.stage;
      opts.emit({ type: 'run.progress', ...base, stage: step.stage, quip: quip(step.quip) });
      // 페르소나 줄도 같은 공백을 content-bearing 한 줄로 메운다 (침묵 = 실패, ≤4s SLA).
      voice.patience(quipTick);
    }
    if (++quipTick >= PATIENCE_PLAN.length) clearInterval(patience);
  }, config.quipPatienceMs);
  try {
    if (session.user_id !== userId) throw new ApiError('FORBIDDEN', '세션 소유자만 메시지를 보낼 수 있습니다.');
    if (session.status === 'archived') throw new ApiError('SESSION_ARCHIVED', '아카이브된 세션입니다.');
    // random_id 멱등 사전 조회 (t_3486b1d7 ①, core.telegram.org/method/messages.sendMessage):
    // 재연결·재전송으로 같은 client_req_id가 다시 들어오면 run 이벤트·user/answer 행을 추가로
    // 만들지 않고 기존 user 행을 돌려준다(프론트는 같은 카드를 in-place 유지). insert의
    // 유니크 인덱스(013)가 2차 방패 — 레이스로 뚫리면 graph가 CONFLICT로 마감한다.
    // run.started 이전 위치: quip fake-timer 이벤트 순서 계약 보존(추가 이벤트 0건으로 종료).
    // 정규화(trim/≤64자)는 사전 조회와 user 행 stamp가 반드시 같은 키를 쓰도록 단일 지점에서.
    const clientReqId = normalizeClientReqId(opts.clientReqId ?? null);
    // 선영속 경로(t_2133e4fc)는 사전 조회 스킵 — 행을 먼저 심은 주체가 handleTr이므로
    // 여기서 같은 client_req_id로 조회하면 자기 선영속 행에 자가-힛트해 턴이 통째로
    // deduped(턴 미실행)가 된다. 멱등 선방어는 persistUserUtteranceEarly가 이미 끝냈다.
    // resume도 스킵: 재실행 대상 run의 client_req_id는 자기 행에 이미 스탬프돼 자가-힛트한다.
    const prior = (opts.resume || opts.persistedUser) ? null : await findExistingByClientReqId(db, session.id, clientReqId);
    if (prior) {
      completed = true; // finally의 run.failed 보장·드레인 트리거 우회 (턴을 실행한 적 없음)
      // ② clientId reconcile 에코 (t_3486b1d7, 프론트 전제조건 코멘트 #198): 같은 client_req_id의
      // message.new을 재발행 — message_id는 기존 행 유지(낙관적 카드와 같은 ID), deduped:true로
      // '재전송이었음'을 표시. 프론트는 pending→sent 확정 + (없던 재시작 세션은) 카드 재생성.
      opts.emit({ type: 'message.new', ...base, message: serializeMessage(prior), user_message_id: prior.id, deduped: true });
      return buildDedupedResult(prior);
    }
    // 세션 제목 자동 채움 (t_cc52fd4f ③, 대표님 9/28): 첫 사용자 메시지 요약 — 캐논 title
    // 컬럼·metadata.title 모두 비어 있는 세션에만, WHERE title IS NULL 가드로 원-라운드트립
    // 선착 세팅(동시 첫 턴 레이스 안전). 실패해도 턴을 오염시키지 않는다(목록은 폴백 규칙 유지).
    // REST sendMessage / WS message.send / PTT 트랜스크립트 / 큐 드레인 전 경로가 이 결절점 통과.
    if (!sessionTitleOf(session)) {
      const derived = deriveSessionTitle(content);
      if (derived) {
        session.title = derived; // 이 run 내 재세팅 방지 (동일 객체 재호출 대비)
        await setSessionTitleIfEmpty(db, session.id, derived).catch(() => undefined);
      }
    }
    // 답변 대기 (t_811e176c) — 발화 = 회신: 이전 미해소 pending 해소 체인을 여기서 시작하되
    // await는 배지 발행 직전으로 미룬다 (run.started 이전 대기 홉 추가 = fake-timer 테스트
    // 파손 — 기존 이벤트 타이밍 계약 보존). 배지 스냅샷은 아래에서 이번 턴 답변 판정과
    // 합쳐 한 번만 낸다(두 전이 1이벤트).
    const resolvingPending = resolvePendingReplies(db, session.id);
    const { data: persona, error } = await db.from('personas').select('*').eq('id', session.persona_id).maybeSingle();
    if (error) throw new ApiError('INTERNAL_ERROR', error.message);
    // 접수 문구는 페르소나 말투를 반영한다 (formal→빠릿하게(brisk), casual→캐주얼하게(playful)).
    personaTone = (persona as { tone_config?: Record<string, unknown> } | null)?.tone_config ?? null;
    // 비서실 백스테이지 릴레이 자막 (t_583d9fed 案1, 대표님 9/28 "일단 a이고"): relationship_type='secretary'
    // 페르소나의 턴에서만 뉴런 릴레이 실체를 자막으로 노출한다. 최종 답변은 기존 계약대로 하나의 통합 메시지(B1)이고,
    // channels/메시지 마이그레이션은 없다. 비서 외 페르소나에서는 이벤트가 0건 — 기존 흐름과 1:1 동일.
    const isSecretaryTurn = (persona as { relationship_type?: string } | null)?.relationship_type === 'secretary';
    const relayCurtain = new RelayCurtain(locale);
    const emitRelay = (stage: RelayStage) => {
      if (!isSecretaryTurn) return;
      const text = relayCurtain.advance(stage);
      if (text !== null) opts.emit({ type: 'relay.updated', ...base, stage, quip: text });
    };
    // ⑤ 이벤트 순서 계약 (t_3486b1d7, 김비서 9/29 A2A): user 카드 → run.started 순.
    // processTurn이 user 저장 직후 onUserCreated/onRunReady를 콜백하므로
    // run.started를 processTurn 호출 후(기존)가 아니라 콜백 내부에서 emit한다.
    // quip fake-timer 테스트 계약(run.started 이전 await 금지)은 콜백 순서로 만족.
    // 페르소나 보이스 버스(t_5cba9ebb main)의 ack/침묵-fill은 onRunReady 안에서 발행한다.
    // 롤백 게이트 (USER_CARD_FIRST=false): 콜백을 미등록하면 processTurn이 아무것도 emit하지
    // 않고, 아래 post-processTurn 경로(run.started → user/empathy/answer 카드)로 484eec2f
    // 베이스의 이벤트 순서·개수와 1:1 복귀한다.
    const cardFirst = config.protocol.userCardFirst;
    let userMessageId: string | null = null;
    if (!cardFirst) {
      // 롤백 경로: ⑤ 이전 형상 — processTurn 호출 전 run.started+ack 버스.
      opts.emit({ type: 'run.started', ...base, quip: quip('started') });
      voice.ack();
      silenceFill = setTimeout(() => voice.stage('research'), PERSONA_SILENCE_FILL_MS);
      lastStage = 'thinking';
      opts.emit({ type: 'run.progress', ...base, stage: 'thinking', quip: quip('ack') });
    }
    const result = await processTurn(db, session.id, userId, session.agent_id, persona ? rowToPersonaConfig(persona) : null, content, {
      turnId,
      locale,
      thread: opts.thread,
      signal: abort.signal,
      sttMetadata: opts.sttMetadata,
      attachmentIds: opts.attachmentIds,
      // random_id 멱등 — 013 적용+플래그 on 시에만 user 행에 stamp (정규화는 runTextTurn 단일 지점).
      clientReqId,
      // 답글 인용 (t_02f58030): 존재+같은 세션 검증은 processTurn 내부 — invalid 무시, 발화 통과.
      replyToId: opts.replyToId,
      // 선(先)영속 user 행 (t_2133e4fc): processTurn은 insert 생략·같은 message_id 재사용.
      persistedUser: opts.persistedUser,
      // ① 답변 스트리밍 전 체감 공백(기본 config.answerLeadMs=3000). 취소·0 통과.
      answerLeadMs: opts.answerLeadMs,
      // 내구성 실행 resume (t_7182aa8f③): 저널 시드 행을 processTurn에 전달 — 저장 지점
      // 가드(user/empathy/answer/tail)와 체크포인터 invoke(null)이 이 시드로 동작한다.
      resume: opts.resume,
      // ⑤ user 카드 사전 emit — run.started 이전에 message.new user 발행 (cardFirst일 때만).
      // 선영속(t_2133e4fc)은 handleTr가 이미 message.new(user)를 선방송했다 — 여기서 재발행
      // 금지(같은 id 2회 = 프론트 카드 중복). id 캡처만 유지(userMessageId = 선영속 id).
      onUserCreated: cardFirst ? (userRow => {
        userMessageId = userRow.id;
        if (opts.persistedUser) return;
        opts.emit({ type: 'message.new', ...base, message: serializeMessage(userRow), user_message_id: userRow.id });
      }) : undefined,
      // ⑤ run.started emit — user 카드 직후 (cardFirst일 때만).
      onRunReady: cardFirst ? () => {
        opts.emit({ type: 'run.started', ...base, quip: quip('started') });
        // 페르소나 첫 발화 (≤2s SLA — 볼트 리서치 2항): 접수 ack을 한 줄로 낸다.
        // run.progress(ack)는 하위 호환으로 유지, 프론트는 persona.line만 렌더한다.
        voice.ack();
        // 4초+ 침묵 fill (research §2): ack 후에도 릴레이 줄이 없으면 content-bearing 한 줄을 강제한다.
        silenceFill = setTimeout(() => voice.stage('research'), PERSONA_SILENCE_FILL_MS);
        // ① 짧은 확인음 (t_344e047a, 대표님 9/28 정정): 공감 복명복창을 대체하는 "예/아니오"
        // 수준 확인음을 접수 직후 run.progress(stage=thinking, 계약 코드 유지)로 내보낸다.
        // lastStage 선점: empathy 노드의 thinking 전환과 동일 stage 코드이므로 dedup되어
        // ack 확인음이 thinking 진행도 1회를 대체한다 (run.started→run.progress(ack)→…계약, t_344e047a).
        lastStage = 'thinking';
        opts.emit({ type: 'run.progress', ...base, stage: 'thinking', quip: quip('ack') });
      } : undefined,
      onTurnStatus: (status, extra) => {
        // 완료/실패는 확정 메시지 발행 이후 이 실행기에서 한 번만 전송한다.
        if (status !== 'processing') return;
        processing = true;
        const stage = extra?.stage || 'thinking';
        if (lastStage === stage) return;
        lastStage = stage;
        opts.emit({ type: 'run.progress', ...base, stage, quip: quip(stage) });
      },
      emitEvent: e => {
        opts.emit({ type: 'neuron.status', session_id: session.id,
          neuron: { slug: e.neuron, name: NEURON_NAMES[e.neuron] || e.neuron }, status: e.status, stage: e.stage, quip: e.quip });
        const relayStage = relayStageForEvent(e);
        if (relayStage) {
          emitRelay(relayStage);
          // persona.line은 릴레이와 달리 페르소나 무관 전 room 채널 (9/29 확정 아키텍처:
          // 한 사람처럼 빈틈없이 — 진행 한 줄은 방 구분 없이 필요하다).
          voice.stage(relayStage);
        }
      },
      // ④ answer.delta 백프레셔 (t_3486b1d7) — 300ms 또는 150자 whichever-first 배칭.
      // deltaBatchMs=0이면 기존처럼 토큰마다 즉시 emit(테스트 기본).
      onAnswerDelta: (() => {
        const batchMs = config.protocol.deltaBatchMs;
        const batchChars = config.protocol.deltaBatchChars;
        const killVoice = () => voice.kill(); // 답변 스트리밍 시작 = 보이스 줄 수명 종료 (첫 답변 문장이 줄을 자연 흡수, 9/29 4항).
        if (batchMs <= 0) return (d: string, i: number) => { if (i === 0) killVoice(); partialText += d; opts.emit({ type: 'answer.delta', ...base, delta: d, index: i }); };
        let buffer = '';
        let pending: ReturnType<typeof setTimeout> | null = null;
        let deltaIndex = 0;
        let first = true;
        const flush = () => {
          if (!buffer) return;
          const d = buffer;
          buffer = '';
          opts.emit({ type: 'answer.delta', ...base, delta: d, index: deltaIndex++ });
        };
        return (d: string, _i: number) => {
          partialText += d;
          buffer += d;
          if (buffer.length >= batchChars) { if (pending) { clearTimeout(pending); pending = null; } if (first) { first = false; killVoice(); } flush(); return; }
          if (!pending) pending = setTimeout(() => { pending = null; if (first) { first = false; killVoice(); } flush(); }, batchMs);
        };
      })(),
    });
    // ⑤ empathy/answer만 emit (user는 onUserCreated에서 사전 발행함; persistedUser 경로는
    // handleTr가 runTextTurn 이전에 이미 message.new(user)를 선방송 — 두 경우 모두 user 제외).
    // cardFirst off면 user 포함 484eec2f 베이스 순서(run.started→user→empathy→answer)로 복귀하되,
    // 선영속이 있으면 user 카드 선방송이 이미 끝나 있어 같은 id 재발행은 금지(t_2133e4fc).
    // source_message_id (김비서 9/29 A2A): persona line은 user_message_id를 태워 프론트 id-set dedupe.
    // cardFirst off에서는 필드 자체를 생략(베이스와 이벤트 페이로드 1:1 동일 계약).
    for (const message of cardFirst
      ? [result.messages.empathy, result.messages.answer]
      : [opts.persistedUser ? null : result.messages.user, result.messages.empathy, result.messages.answer]) {
      // serializeMessage: devstore 기본값 미충족·011 이전 행의 awaiting_reply를 false로 정규화
      // (WS message.new = REST 히스토리 동일 형상 계약).
      if (message) opts.emit({ type: 'message.new', ...base, message: serializeMessage(message), ...(cardFirst ? { source_message_id: userMessageId } : {}) });
    }
    // 비서실 마무리·종료 비트 — 커튼이 단조 증가만 허용하므로 visual이 먼저 'wrapping'을 받은
    // 턴은 dedup된다. run.completed는 항상 마지막 이벤트로 남긴다(phase2-contract 계약).
    emitRelay('wrapping');
    opts.emit({ type: 'answer.done', ...base, ai_generated: true, locale, text: result.answerResponse || '', message_id: result.answerMessageId,
      llm: { ...result.llm, usage: result.llm.usage ?? null }, grounding: result.grounding });
    // 답변 대기 (t_811e176c) — 해소/감지 전이가 있었을 때만 스냅샷 발행(매 턴 노이즈 금지).
    // run.completed 뒤에 내지 않는 이유: events.at(-1)=run.completed 계약이 기존 단위테스트
    // ·프론트 종료 처리가 의존한다. 프론트는 이벤트 순서 무관(전용 리스너).
    const resolvedPending = await resolvingPending;
    if (resolvedPending > 0 || result.replyRequest) {
      const snap = await replyPendingSnapshot(db, session.id);
      if (snap) opts.emit({ type: 'reply.pending.updated', ...base, ...snap });
    }
    emitRelay('done');
    opts.emit({ type: 'run.completed', ...base,
      structured: { dialogue_type: result.structured.dialogue_type, structured_payload: result.structured.structured_payload },
      classifier: { type: result.dialogueType, stage: result.dialogueStage, confidence: result.dialogueConfidence },
      message_ids: { user: result.userMessageId, empathy: result.empathyMessageId, answer: result.answerMessageId }, llm: result.llm,
      grounding: result.grounding });
    completed = true;
    return result;
  } catch (err: any) {
    if (err?.code === 'RUN_CANCELLED') {
      completed = true;
      opts.emit({ type: 'run.cancelled', ...base, partial_text: partialText });
    }
    failure = { code: err?.code || 'INTERNAL_ERROR', message: err?.message || failure.message };
    throw err;
  } finally {
    clearInterval(patience);
    if (silenceFill) clearTimeout(silenceFill);
    unregister();
    // WS message.send를 포함한 모든 호출 경로에서 실패 종료를 보장한다.
    if (!completed) {
      if (!processing) opts.emit({ type: 'run.progress', ...base, stage: 'thinking', quip: quip('thinking') });
      opts.emit({ type: 'run.failed', ...base, error: failure });
    }
    // ② run 완료 후 세션 큐 순차 처리 (t_344e047a). unregister 이후라 hasActiveRun이 정확하다.
    // 워커 실패가 응답 경계를 오염시키지 않게 fire-and-forget (드레인 내 실패는 skipped로 표시).
    if (completed) void drainSessionQueue(db, session.id, userId, opts.emit).catch(() => undefined);
  }
}

// ── ② 질문 큐 워커 (t_344e047a) ──────────────────────────────────
// 드레인 재귀 방지: 세션별 활성 드레인 1개. 드레인 중 실행된 턴의 완료 체인은
// 플래그 때문에 즉시return하고, 도는 루프가 새 pending을 다음 iteration에서 주운다.
const drainingSessions = new Set<string>();

/**
 * 완료된 run의 후속 처리: 세션 큐의 pending을 position 순서로 하나씩 답변한다.
 * 실행이 이미 활성화되어 있으면(다른 발화가 앞섬) 나가되 행은 pending으로 남아
 * 그 실행의 완료 체인이 이어받는다 — 유실 없음.
 */
export async function drainSessionQueue(
  db: DbClient, sessionId: string, userId: string, emit: (e: TurnEmitEvent) => void
): Promise<void> {
  if (drainingSessions.has(sessionId)) return;
  drainingSessions.add(sessionId);
  try {
    let round = 0;
    for (;;) {
      if (hasActiveRun(sessionId)) return; // 새 실행이 끼어들면 그 실행의 완료 체인이 드레인을 이어받는다
      const all = await listQueue(db, sessionId);
      const pending = all.filter(i => i.status === 'pending');
      if (!pending.length) return;
      const { data: session } = await db.from('sessions').select('*').eq('id', sessionId).maybeSingle();
      if (!session || (session as SessionsRow).status === 'archived') {
        // 아카이브/소멸 세션: 미답변을 체크포인트 'skipped'로 마감 (유실 아님, 보이게).
        await skipAllPending(db, sessionId);
        emit({ type: 'queue.updated', session_id: sessionId, ...queueSnapshot(await listQueue(db, sessionId)) });
        return;
      }
      const item = pending[0];
      try {
        await runTextTurn(db, session as SessionsRow, userId, item.content, { locale: item.locale, emit });
        await markQueueStatus(db, item.id, 'answered');
      } catch {
        // 실패도 체크포인트에 남긴다 — 대답 안 한 것이 보이게 (유실과 구분).
        await markQueueStatus(db, item.id, 'skipped').catch(() => undefined);
      }
      emit({ type: 'queue.updated', session_id: sessionId, ...queueSnapshot(await listQueue(db, sessionId)) });
      // 라운드 캡 초과 잔량은 다음 발화/완료 체인이 이어받는다 (무한 루프 방패).
      if (++round >= config.questionQueue.maxBatch) return;
    }
  } finally {
    drainingSessions.delete(sessionId);
  }
}


/** 멱등 재사용 응답 조립 (t_3486b1d7 ①) — 재실행 없이 기존 user 행으로 TurnResult 형상을 만든다.
 *  실행 이력이 없는 재구성이라 llm/structured/events는 중립값; 프론트는 user_message_id와
 *  messages.user만 읽는다 (deduped 플래그로 REST/WS 모두 새 run으로 취급하지 않는다). */
function buildDedupedResult(prior: MessagesRow): IdempotentTurnResult {
  return {
    deduped: true,
    turnId: prior.id,
    llm: { used: false, model: null, fallback: false },
    messages: { user: prior, empathy: null, answer: null },
    userMessageId: prior.id,
    empathyMessageId: null,
    answerMessageId: null,
    empathyResponse: null,
    answerResponse: prior.content,
    structured: { dialogue_type: 'text', structured_payload: (prior.structured_payload ?? {}) as Record<string, unknown>, classifier: 'rules' },
    suggestedQuestions: [],
    replyRequest: null,
    dialogueType: 'information',
    dialogueStage: 3,
    dialogueConfidence: 0,
    grounding: null,
    activationPlan: { activate: [], reason: 'idempotent-replay', dialogueType: 'information' },
    events: [],
    guardPassed: true,
    engine: 'simple',
  };
}

/** 텍스트 전송 REST 응답을 스레드와 일반 대화에서 공유한다. */
export function textTurnResponse(result: TurnResult) {
  return {
    locale: result.messages.user.locale,
    ai_generated: true,
    run_id: result.turnId,
    turn_id: result.turnId,
    llm: result.llm,
    structured: result.structured,
    messages: result.messages,
    // ① random_id 멱등 — 재전송 dedupe 응답 표시 (프론트는 user_message_id로 카드 in-place 유지,
    // deduped:true면 새 run으로 취급하지 않는다). 정상 실행은 항상 false/undefined.
    deduped: 'deduped' in result && result.deduped === true,
    user_message_id: result.userMessageId,
    empathy_message_id: result.empathyMessageId,
    answer_message_id: result.answerMessageId,
    empathy_response: result.empathyResponse,
    answer_response: result.answerResponse,
    dialogue_type: result.dialogueType,
    /** 판별 신뢰도 공개 계약 (t_56498848) — stage: 1=패턴 2=LLM 3=폴백/수동 */
    classifier: { type: result.dialogueType, stage: result.dialogueStage, confidence: result.dialogueConfidence },
    grounding: result.grounding,
    activation_plan: result.activationPlan,
    suggested_questions: result.suggestedQuestions,
    /** 답변 대기 (t_811e176c) — 감지 시 {kind, excerpt}, 없으면 null. 행은 awaiting_reply=true. */
    reply_request: result.replyRequest,
    neuron_events: result.events,
    persona_guard_passed: result.guardPassed,
    engine: result.engine,
  };
}

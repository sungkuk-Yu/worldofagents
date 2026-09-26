/** 구조화 추출은 fetch 모킹으로만 검증하며 외부 LLM에 연결하지 않는다. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../src/config';
import { classifyByRules, classifyStructured } from '../../src/lib/structured';

const table = '| 항목 | 수량 |\n| :--- | ---: |\n| 사과 | 2 |\n| 배 | 3 |';
beforeEach(() => {
  vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(true);
  vi.spyOn(config.chatLlm, 'apiKey', 'get').mockReturnValue('test-key');
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function respond(content: string) {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content } }] })));
}

describe('규칙 카드', () => {
  it('마크다운 표의 열과 행을 추출한다', () => {
    expect(classifyByRules('재고', 'data', table)).toEqual({ dialogue_type: 'spreadsheet', classifier: 'rules',
      structured_payload: { title: '재고', columns: ['항목', '수량'], rows: [['사과', '2'], ['배', '3']] } });
  });
  it.each(['표 없음', '| 항목 | 수량 |\n| --- | --- |\n| 값 |'])('표 파싱 실패는 정보 카드로 대체한다: %s', answer => {
    expect(classifyByRules('재고', 'data', answer)).toMatchObject({ dialogue_type: 'info_card', structured_payload: { summary: answer } });
  });
  it('체크리스트와 번호 목록을 대기 작업으로 추출한다', () => {
    expect(classifyByRules('작업', 'task', '- [ ] 준비\n- [x] 검토\n1. 실행\n2) 확인').structured_payload.items).toEqual(
      ['준비', '검토', '실행', '확인'].map(title => ({ title, status: 'pending', detail: null })),
    );
    expect(classifyByRules('작업', 'task', '목록 없음').structured_payload.items).toEqual([{ title: '작업', status: 'pending', detail: null }]);
  });
  it('질문은 길이를 제한한 정보 카드로 만든다', () => {
    expect(classifyByRules('가'.repeat(60), 'question', '나'.repeat(220))).toEqual({ dialogue_type: 'info_card', classifier: 'rules',
      structured_payload: { title: '가'.repeat(50), summary: '나'.repeat(200) } });
  });
  it('일반 대화와 파일 및 협업의 기본 payload를 반환한다', () => {
    expect(classifyByRules('안녕', 'information', '반가워요')).toEqual({ dialogue_type: 'text', structured_payload: {}, classifier: 'rules' });
    expect(classifyByRules('파일', 'file', '').structured_payload).toEqual({ files: [] });
    expect(classifyByRules('협업', 'multi', '').structured_payload).toEqual({ agents: [] });
  });
});

describe('LLM 구조화', () => {
  it('비스트리밍 JSON payload를 전달하고 토큰 상한과 모델 및 신호를 유지한다', async () => {
    const card = { dialogue_type: 'spreadsheet', structured_payload: { title: '재고', columns: ['항목'], rows: [['사과']] } };
    respond(JSON.stringify(card));
    const controller = new AbortController();
    expect(await classifyStructured('재고', 'data', table, controller.signal)).toEqual({ ...card, classifier: 'llm' });
    const options = vi.mocked(fetch).mock.calls[0][1]!;
    const body = JSON.parse(options.body as string);
    expect(body).toMatchObject({ model: config.chatLlm.model, max_tokens: 512, stream: false });
    expect(JSON.parse(body.messages[1].content)).toEqual({ userMessage: '재고', answerText: table });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
  it('429는 규칙으로 대체한다', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('제한', { status: 429 }));
    expect(await classifyStructured('재고', 'data', table)).toEqual(classifyByRules('재고', 'data', table));
  });
  it.each(['깨진 JSON', 'null', '{"dialogue_type":"data","structured_payload":{}}', '{"dialogue_type":"file","structured_payload":[]}'])('잘못된 응답은 규칙으로 대체한다: %s', async content => {
    respond(content);
    expect(await classifyStructured('파일', 'file', '답변')).toEqual(classifyByRules('파일', 'file', '답변'));
  });
  it.each(['information', 'command', 'question'] as const)('%s는 LLM을 호출하지 않는다', async type => {
    expect(await classifyStructured('질문', type, '답변')).toEqual(classifyByRules('질문', type, '답변'));
    expect(fetch).not.toHaveBeenCalled();
  });
  it('LLM 미설정 및 이미 취소된 신호는 호출하지 않는다', async () => {
    const controller = new AbortController();
    controller.abort();
    expect((await classifyStructured('파일', 'file', '답변', controller.signal)).classifier).toBe('rules');
    vi.spyOn(config.chatLlm, 'enabled', 'get').mockReturnValue(false);
    expect((await classifyStructured('파일', 'file', '답변')).classifier).toBe('rules');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('추출 중 취소도 규칙 결과를 반환한다', async () => {
    const controller = new AbortController();
    vi.mocked(fetch).mockImplementation(async (_url, options) => {
      controller.abort();
      expect(options?.signal?.aborted).toBe(true);
      throw new DOMException('취소', 'AbortError');
    });
    expect(await classifyStructured('파일', 'file', '답변', controller.signal)).toEqual(classifyByRules('파일', 'file', '답변'));
  });
});

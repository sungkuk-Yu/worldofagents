# Round 10 — "AT" 이중판독 상징 마크 4안 (t_f513cb03, 2026-09-28)

대표님 피드백(9/28): "뭔가 상징적으로 해줄 수 없나 이거지. 글자를" — Round 9 볼드
텍스트 3안은 상징성 0으로 기각. **핵심 인사이트: @ 기호의 이름이 곧 'at'이고, 우리
제품은 '에이전트에게 말 건다(@mention)'** → AT가 동시에 @/말풍선으로 읽히는 이중 판독.
생성형 AI 원칙 유지: fontTools(Pretendard, SIL OFL)+SVG 코드 수작업, 생성 0회.

## 저작·권원 근거

- 타입 소스: Pretendard Variable (orioncactus), SIL OFL 1.1 — wght900 대문자 A·T(+@)
  글리프 경로 베이크 허용 (`apps/mobile/MyAgentTalk/assets/fonts/Pretendard-OFL-LICENSE.txt`).
- 상징 기하는 전부 인간 저작 좌표 계산: 원환(annulus) 스팬/반경, 캐브 삼각 winding,
  even-odd 천공 스케일·위치, 용접 삼각 — build_round10.py에 실측 좌표 주석.
- 경계: 문자·@ 기호 자체는 독점 불가 → 식별력은 조합. 출원 전 키프리스/TMview 유사검색 필요.

## wght900 실측 (폰트u, y-up, 캡 1448) — 라운드 공통 좌표대

- A adv1569: 외곽 (45,0)(526,1448)(1043,1448)(1524,0)(1113,0)(790,1059)(778,1059)(456,0)
  — 세모구멍은 외곽 concave V + 가로대 rect x[384,1179]×y[285.4,571.7] 병합(CW union) 구조.
  (Round9 주석의 "구멍 y571→1059"는 rect 상단 기준 오기, 실측으로 정정)
- T adv1360: 바 x[55.5,1304.1]×y[1140.8,1448], 스템 x[492.6,867.1]
- @ adv1783: bbox [88.9,-208,1694.2,1430]

## 4안

| 안 | 디렉터리 | 이중 판독 | 기하 | 16px 게이트 |
|---|---|---|---|---|
| 1 | `opt1_at_roundat/` | 글자 AT + 실루엣 @ | A(0.685스케일)를 @ 안쪽 a로 내경 수납(발이 하단 환 밴드와 접선 용접), T 바(307u)→296° 원환 R[620,927]·T 스템→우측 세로획+꼬리발 | **PASS** (@+A) |
| 2 | `opt2_speech_counter/` | 글자 AT + A의 입 | A 세모 구멍 밑변(y571.7)에서 가로대를 아래로 찢는 CCW 삼각 캐브(560,285.4) — 구멍이 말풍선, T 정통. winding 상쇄로 nonzero/even-odd 모두 정확 천공 | **PASS** (AT) |
| 3 | `opt3_negative_at/` | 글자 AT + 흰 @ | DX=880 heavy fusion(각획-스템 용접 삼각) 덩어리, T 바에 @ 글리프(0.16스케일=262u) even-odd 천공 — FedEx 식 원리 | FAIL (@ 소실) |
| 4 | `opt4_t_speech_arrow/` | A가 T에게 말 거는 도해 | T 바→A 우견에서 화살(우단 촉)+바 위 말풍선 꼬리, 스템 유지 | FAIL (AT 난독) |

**자산화 판정**: 안1·안2 통과분만 자산(아래 16파일 세트). 안3·안4는 16px 탈락 — 시트
`comparison-sheet-round10.png`에 탈락 표기. 안3은 1024 전용 워드마크 변주, 안4는
슬로건 일러스트 계열로만 재사용 가능.

## 하드 게이트

- 2색 #00A86B+흰색: 전 PNG 화소 보간선 클램프, 이탈 0.0000% — `check_round10.py` PASS
- 16px 판독: favicon16 10배 확대 육안 QC — 안1 (@+A)·안2 (AT) 통과, 안3·안4 탈락 표기
- 일러스트 금지·글자/획만: 글리프 아웃라인 + 타이포 구조물(환·캐브·천공·화살)뿐
- 생성형 AI 배제: 파이프라인 = fontTools → SVG path → cairosvg, 이미지 생성 모델 0회

## 안당 16파일 구조 (Round 8/9 규격 동일)

- `master.svg` 초록마크/투명 · `master-inverted.svg` 흰마크/투명 · `mark-transparent-1024.png`
- `favicon/` favicon.svg + favicon16/32/64.png (흰지판 초록마크 = 16px 판독 통과본)
- `appicon/` appicon-white-{1024,512,180,120}.png · appicon-green-{…} · appicon-adaptive-fg-1024.png

## 빌드/검증

- `build_round10.py` — 글리프 추출·4안 조판·16파일×4 산출·2색 클램프
- `build_sheet_round10.py` — `comparison-sheet-round10.png` (1024+64/32/16 실측열+상징 해설+판독 판정)
- `check_round10.py` — 2색 이탈 게이트 + 16px 잉크 카운트
- `probe_round10.py` `dump_at.py` `probe_at_glyph.py` `probe_A_scan.py` — 실측 프로브(좌표 근거)

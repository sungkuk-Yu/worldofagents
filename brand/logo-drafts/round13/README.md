# Round 13 — Recraft/Nano Banana 생성 전환: '人↔에이전트 소통' 진짜 상징 마크 (t_59c343c7, 2026-09-28)

대표님 9/28 솥 원문: "전혀 이미지가 상징화 안됐는데? 상징화라는 단어부터 숙지하고
파이썬으로 이미지 만들지 말고, recraft나 나노바나나 툴을 가지고 만들어"

**정책 전환(이 카드 한정)**: Python/fontTools 수작업 SVG 조판 금지 → 생성형 필수.
Round 8~12 타이포 라인은 아카이브(자산 보관, 선택 유보).

## 진행 요약 (실제 생성: Recraft 12회 + Nano Banana 12회, 합성/날조 0)

### 1차 — Recraft V4 6서사 (drafts_rc/s1~s6)
`gen_round13_rc.py` (model=recraftv4_vector, style 생략 — 'Vector art' 스타일명은
400 거부, 무스타일이 정답. 폴백 v3_vector는 1건만 사용).
**전원 탈락(상징화 실패 재현)**: s1 악수→사람+로봇 전신 일러스트, s2 두 머리→아르
누보 세밀 얼굴, s3 새→깃털 독수리+검은 외곽선, s4 파형→꽃무늬 타일+액자, s6 매듭→
등산하는 사람 두 명. 결론: 일러스트 금지 지시만으론 Recraft가 서사를 인물화로 해석.

### 2차 — Recraft V4 기하 강제 6서사 (drafts_rc/s*_v2)
`gen_round13_rc_v2.py` — "Abstract GEOMETRIC LOGO ICON, max 5 shapes, NO humans/
bodies/faces, WWF-level simplicity" 하드게임을 프롬프트 선두에. 성과: 6안 모두
추상 도형으로 수렴.

### Nano Banana — 동일 6서사 × clean/mini 2변주 (drafts_nb/, 12장)
`gen_round13_nb.py` (OpenRouter google/gemini-3.1-flash-image). mini 변주
("favicon-first, fewest shapes")가 일관되게 더 깔끔.

## 후보 6안 (comparison-sheet-round13.png, 안당 master1024/favicon16·32·64/transparent)

| 안 | 도구·원본 | 서사 | 판정 |
|---|---|---|---|
| c1_knot_rc | Recraft V4 s6_knot_v2 (SVG 원본 final/c1_knot_rc.svg) | 무한 매듭: 좌 원형(인간)·우 모난(에이전트) 직조 | 강력. 16px 살아있음. 단 우측 각이 약해 좌우 대비 흐림 |
| c2_wave_rc | Recraft V4 s4_wave_fountain_v2 (SVG final/c2_wave_rc.svg) | 동심원 신호 좌우 양방향 송수신 | 16px GOOD. 단 '타깃/스피커' 연상이 '소통'보다 약함 |
| c3_door_rc | Recraft V4 s5_open_door_v2 (SVG final/c3_door_rc.svg) | 반쯤 열린 문+답변 점 | 16px GOOD. 여운 있음, 즉발 소통감은 최상위권 아래 |
| c4_knot_nb | Nano Banana s6_knot_mini | 매듭 — 좌 완전원(인간)·우 스타디움 사각(에이전트) 대비 선명 | **최강 추천**. 16px 65/256 잉크로 형태 보존, over-under 직조 가독 |
| c5_hand_nb | Nano Banana s1_handshake_mini | 사람 손+로봇 손 사이 공(메시지) 전달 | 서사 최직관. 16px에서 손가락 53→뭉침 위험(테두리형 한계) |
| c6_heads_nb | Nano Banana s2_two_heads_mini | 초록 실루엣 머리 ↔ 격자 머리, 사이 신호 대시 | 아이콘세트 티. 16px 최약(53/256, 격자 소멸) |

## 게이트 결과 (build_check_round13.py)

- 2색 팔레트: 전 안 off-palette **0.00%** (한계 2%). c1/c2 원본은 AI가 오렌지그린
  (#16B659 계열) 렌더 → 수작업 지오메트리 수정이 아닌 **기계적 2색 클램프**
  (명도축 green↔white 투영, clamp2())로 정규화. 형태 픽셀 불변.
- 16px 판독: ink@16px 53~104/256 전부 형체 유지(시트 실측 열 참조).
- 배경 투명 PNG + 다크bg 병기(시트 우측열).

## 법무 추적성 — 생성 프롬프트 원문 위치

- Recraft 1·2차: `rc_log.jsonl` (안당 name/model/prompt 원문 전체)
- Nano Banana: `nb_log.jsonl` (동일)
- 생성 스크립트: `gen_round13_rc.py` / `gen_round13_rc_v2.py` / `gen_round13_nb.py`
- AI 생성물 리스크 고지 유지: **최종 선택 후 사람이 트레이스·단순화하는 '2차 수작업
  마감' 단계를 계획란에 메모** (상표 출원 전략). 특히 c4/c1 매듭은 기존 무한대/체인
  마크와의 식별성 검토 필요.

## 사고 기록 (실패·우회 3분)

1. **Recraft 400 'Invalid style Vector art'**: V4 벡터 엔드포인트는 style 파라미터
   거부(라운드 11fix 답습 오류). probe_v4.py로 무스타일 200 확인 후 조건부 주입으로
   수정. 재발방지: 외부 API 조합은 본 생성 전 1건 프로브.
2. **Recraft 400 'prompt length ≤1000'** (s2 1차): HARD+서사 합산 초과. 서사 압축으로
   해결. 재발방지: 프롬프트 템플릿 상한 사전 검사.
3. **1차 Recraft 전원 일러스트 드리프트** (인물화·깃털·액자): '심벌' 지시 불충분 —
   2차에서 도형 어휘·형상 수 상한·부정목록(NO humans) 강제. 재발방지: 로고 생성엔
   "geometric icon, max N shapes" 구문을 기본 하드블록으로.
4. **클램프 전 오프팔레트 27%/3%** (c1/c2 오렌지그린): 생성형 색 편차는 재생성 대신
   luminance-axis 투영으로 확정 처리 — 색 재현 편차 0. 재발방지: AI 산출물은 항상
   clamp2 후 게이트.
5. **시트 빌드 unpack 오류**(결과 튜플 3개 vs 2개 수신): 즉시 수정 재실행.

## 다음 (대표님 선택 대기)

- 6안 중 선택 → 그 안만 '2차 수작업 마감'(트레이스·대칭 확정·SVG path화) 제안.
- 미러/변주(예: c4 매듭 두께·각진기 정도) 필요 시 이 스크립트 체계로 재생성.

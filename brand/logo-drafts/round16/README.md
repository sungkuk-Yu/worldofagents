# Round 16 — f3 말풍선·f4 노드 2안 정밀 발전 (둥근 A 교정 포함) (t_80e9d22e, 2026-09-28)

대표님 9/28 슛: R15 비교시트에 초록 마커로 **f3 버블카운터·f4 실심노드** 두 안 선택 + "이 두 개로 개선해".
→ f3 계보 3변주(부정공간 정밀화/16px 볼드/둥근 A 교정) + f4 계보 3변주(노드 손잡이 이중판독/극한 미니/둥근 A 교정) = 6안.
"둥근 A"는 대표님 원래 지시(R14)로 회귀한 교정판 — 카드 제목에 명시된 대로 봉우리 라운딩 변주를 각 계보에 1개 포함.

## 규율 (Round 13-15 계승)
- 생성형 필수(수작업 SVG 조판 0회): Nano Banana(gemini-3.1-flash-image) 6회 실생성 전원 성공.
  Recraft arm은 9/28 R15 중 크레딧 고갈 지속 → 김비서 지시대로 NB 우선(내일 크레딧 신 시 교차 보강 여지).
- 2색 #00A86B+white 게이트, prompt ≤1000자 사전 assert, 지오메트리 하드스펙 문구, 프롬프트 원문 nb_log.jsonl
- 빌드 파이프라인 동일: crop_square → clamp2 → palette_gate → ink16 → favicon 16/32/64 + transparent + on-dark

## 6안 (final/, 게이트 전원 off-palette 0.00%)
|| 안 | 계보·의도 | ink@16px |
|---|---|---|---|
| g1_f3_bubble_refine | f3·꼬리 수직 하향+버블 45% 비율+두께 균일 프레임 정밀화 | 62 |
| g2_f3_bubble_bold16 | f3·A 다리를 매우 두껍게, 꼬리도 두껍게 — 16px 말풍선 가독성 특화 | 78 |
| g3_f3_bubble_roundA | f3·둥근 돔 봉우리 A 교정판(대표님 원래 '둥근 A' 회귀) | 96 |
| g4_f4_node_knob | f4·노드를 가로대 우측에 붙여 문손잡이↔응답노드 이중판독 | 59 |
| g5_f4_node_mini | f4·A+점 하나 극한 미니 — 파비콘 시험대 | 64 |
| g6_f4_node_roundA | f4·둥근 돔 봉우리 A 교정판+중앙 노드 | 88 |

BASE 행 2개는 R15 f3(79)·f4(75) 마스터 — 시트 상단에 병기해 개선 폭 비교 가능.

### 심사 코멘트 (16px·on-dark, 시트 육안 QC + zoom16-round16.png x16 확대 정밀 QC)
- **f3 계보 최강 = g3_roundA**: 둥근 A+버블+꼬리가 16px에서 전부 살아있고(ink 96) on-dark 안정. g2_bold16은 A는 견고하나 상단 삼각 잔여 구멍이 말풍선과 이중 카운터로 읽힘(ink 78), g1_refine은 각진 A 다리가 얇아지고 꼬리 소실(ink 62) — 탈락 수준.
- **f4 계보 최강 = g6_roundA**: 둥근 A+노드(ink 88)로 R15 f4(뾰족·딱딱)를 교정, 16px에서 노드 뚜렷. g5_mini(64)는 A는 또렷하나 노드가 옅어짐, g4_knob(59)은 각진 다리+가로대 융합으로 손잡이 서사 소실 — 최약.
- zoom16 순위: g3 > g6 > g2 > g5 > BASE f4 ≈ g1 > BASE f3 > g4. 둥근 A 교정판 2개가 두 계보 모두 BASE를 상회.
- 추천: 마크 통합 후보 = g6_f4_node_roundA(파비콘 겸용 최강), 서사형(32px+) = g3_f3_bubble_roundA. 둥근 A 교정판 2개가 대표님 지시 회귀분이라 최종 후보로 유력.

## 사고 1건 (원인/조치/재발방지)
1. **카드 본문 truncation 재발(2회째)**: t_80e9d22e body가 175자에서 절단 — R14 사고(f66083d4 기록)와 동일 증상.
   조치: 김비서 state.db messages(id 22202 tool_calls·22206 회신)에서 발전 지시 전문(f3 3변주·f4 3변주 스펙) 복원 후 진행.
   재발방지: 발주 측(김비서) 카드 body 작성 시 kanban_create 인자 길이 상한 점검 필요 — R14와 동일 패턴이면 스키마/전송 계층 문제. photo 측으로는 카드 수신 즉시 body 끝이 문장 중간이면 즉시 발행자 DB 조회를 표준 절차화.

## 파일
- gen_round16_nb.py — 프롬프트 원문 내장(6 brief), nb_log.jsonl 법무 추적
- build_check_round16.py — 6안 빌드+게이트 + R15 BASE 2행 병기 비교시트
- comparison-sheet-round16.png — BASE2+6안 (1024/64/32/16/on-dark)
- zoom16.py / zoom16-round16.png — 파비콘 16px x16 확대 정밀 QC 시트
- final/ — 안당 master1024/fav16·32·64/transparent (총 30파일)
- drafts_nb/ — NB 원본 6장

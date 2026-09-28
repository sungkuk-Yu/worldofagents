# Round 15 — 뾰족 A 형상의 문 + 안의 대화(i) 발전안 (t_8fd7e948, 2026-09-28)

대표님 9/28 슛: "문이 열리고 i의 다이얼로그가 보이는거 접근법 좋아. 대신 문을 뾰족 에이로 형상화 해봐"
→ 기준안 Round 14 **RC-e1 double_door**(아치문+사각 개구 이중문)의 외곽 아치를 **뾰족 A 실루엣**으로 교체.
A=에이전트가 곧 문(개방형 존재), 문 안 사각 개구=‘i의 다이얼로그’ 유지. A 실루엣은 대표님 지시로 형태로서 허용(글자 강제 없음 관례의 명시적 예외).

## 규율 (Round 13/14 계승)
- 생성형 필수(수작업 SVG 조판 0회): Recraft V4 vector 4회 시도(2 성공·2 크레딧 고갈) + Nano Banana 8회 = 실생성 12회
- 2색 #00A86B+white 게이트, prompt ≤1000자 사전 assert, 지오메트리 하드스펙 문구
- 빌드 파이프라인 round14와 동일: crop_square → clamp2 → palette_gate → ink16 → favicon 16/32/64 + transparent + on-dark 시트

## 4변주 스펙 → 6안 (final/, 게이트 전원 off-palette 0.00%)
| 안 | 변주·의도 | 소스 | stem | ink@16px |
|---|---|---|---|---|
| f1_square_nb | f1·뾰족 A 문+안 사각 말풍선 개구(e1 직역) | Nano | f1_a_door_square_clean | 74 |
| f2_step_nb | f2·A 윤곽문 반쯤 열림, i가 문틀 넘어서 나옴(열림 강조) | Nano | f2_a_outline_open_i_clean | 73 |
| f3_bubble_nb | f3·A 카운터 자체가 말풍선(꼬리 아래 문턱) | Nano | f3_a_door_bubble_clean | 79 |
| f4_node_nb | f4·A 문 안 초록 실심 노드=에이전트 응답의 정점 | Nano | f4_a_door_node_clean | 75 |
| f1_square_mini | f1·mini 변주(clean/mini 교차채택 관례) | Nano | f1_a_door_square_mini | 68 |
| f4_node_mini | f4·mini 변주 | Nano | f4_a_door_node_mini | 70 |

### 탈락 드래프트 (drafts_rc·drafts_nb 에 원본 보존)
- RC f1: A 실루엣은 성립하나 안쪽이 A+사각+꼬리+막대 4중 중첩으로 지저분(16px 붕괴 리스크) → NB clean 채택
- RC f2: 말풍선이 A 오른쪽 다리를 뚫고 겹치며 A 형상 훼손 → NB clean 채택
- NB f2: 서사('stepping out') 최강이나 A 하단 다리가 잘려 16px에서 A 판독 약함 — 후보 유지, 16px 최우선이면 감점
- NB f3: 버블 카운터가 16px에서 흰 덩어리로 뭉개짐(꼬리 소실) — 서사 대비 판독 최약

### 심사 코멘트 (16px·on-dark)
- **f4_node** 계열이 16px 최강: 뾰족 A+점 하나라 축소 시 형체·내부 요소 모두 유지, on-dark도 안정.
- **f1_square** 계열이 스펙 직역(사각 개구=다이얼로그)에 충실, 32px 이상에서 서사 명확.
- 추천: 파비콘= f4_node_mini, 마크/워드마크 병기용= f1_square_nb.

## 사고 1건 (원인/조치/재발방지)
1. **Recraft 크레딧 고갈**: f1·f2 생성 후 f3·f4에서 HTTP 400 `not_enough_credits` — 라운드 중 유료 잔액 소진.
   조치: f3·f4는 Nano Banana arm으로 전량 대체(교차 채택 관례상 무손실). rc_log.jsonl에 실패 원문 기록.
   재발방지: 라운드 착수 전 Recraft 잔액 확인, 또는 f1~f4를 NB 선행 후 RC 보강 순서로 전환 검토.

## 파일
- gen_round15_rc.py / gen_round15_nb.py — 프롬프트 원문 내장, rc_log.jsonl·nb_log.jsonl 법무 추적
- build_check_round15.py — 6안 빌드+게이트 (round14 파이프라인 재타깃)
- review-sheet-round15.png — 10드래프트 심사 시트 / comparison-sheet-round15.png — 최종 6안 시트
- final/ — 안당 master1024/fav16·32·64/transparent (RC SVG 원본은 f1·f2 2안만 존재)

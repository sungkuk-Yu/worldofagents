# Round 17 — 'A(문)에서 I(사람)가 빠져 → 말풍선' 확정 서사 4변주+mini (t_a9997448, 2026-09-28)

대표님 9/28 원문: "저 위에 빨간 부분 안에 있는 실제 문에서 채팅 버블이 빠져 나오는 거 동일하게 하고,
문이 에이라 비슷하게 생겼으니까 문을 에이처럼 비슷하게 만들어주고, 그 에이라는 문에서 아이라는 놈이
빠져 나와서 채팅 버블 만드는 것처럼" — 기준안 = R15 시트 최상단 RC-e1 double_door(빨간 마커).
서사 확정: **문(外)=A(에이전트) 실루엣, 문에서 I(사람 글리프: 사각 머리+세로 몸, 무안면)가 반쯤 얼굴,
I 옆에서 단일 말풍선(꼬리 1개)이 만들어지는 순간.**

## 규율 (Round 13-16 계승)
- 생성형 필수(수작업 SVG 조판 0회): Nano Banana(gemini-3.1-flash-image) 5회 실생성 전원 성공.
  Recraft 교차 probes 1회 → **400 not_enough_credits 재확인**(9/28 R15 소진 지속, rc_log 원문 기록).
- 2색 #00A86B+white 게이트, prompt ≤1000자 사전 assert(h1 920/h2 925/h3 917/h4 952/mini 981),
  지오메트리 하드스펙 문구, 말풍선 단일·꼬리 단일·I 최소 Ink 명시(이전 라운드 반복 실수 금지 조항 반영)
- 프롬프트 원문 nb_log.jsonl / rc_log.jsonl 법무 추적

## 5안 (final/, 게이트 전원 off-palette 0.00%)
|| 안 | 변주 의도 | ink@16px |
|---|---|---|---|
| h1_a_door_i_bubble | e1 골격 직역: 뾰족 A문 + I 빠져나옴 + 말풍선 | 57 |
| h2_roundA_i_bubble | g6 라운딩(돔) A문 + I + 말풍선 — 둥근 A 계보 승계 | 101 |
| h3_halfopen_door | 반쯤 열린 문(오른쪽 다리=30° door leaf) + I + 말풍선 | 64 |
| h4_negative_i | A문 통짜 채움 + 부정공간 말풍선, 16px 특화 | 92 |
| h4_negative_mini | h4 mini 압축 재시도 (극한 단순화) | 83 |

BASE 2행은 R16 최강 g3(96)·g6(88) — 시트 상단 병기.

### 심사 코멘트 (comparison + zoom16-round17.png x16 확대 정밀 QC)
- **h2_roundA 최강(ink 101)**: 돔 A 실루엣이 16px에서 가장 견고하고 I 글리프(머리+몸)와 말풍선이
  모두 인식됨. R16 g6 계보의 둥근 A 장점에 확정 서사(I+버블)까지 온전히 탑승 — 마크 유력 후보.
- **h4_negative_i 차선(92)**: A 프레임이 무거워 파비콘 안정, 문 안 I 또렷. 다만 말풍선이 꼬리
  노치 정도로 옅어 서사 약화. mini 재시도(83)는 A는 유지됐으나 버블이 더 옅어져 역효과 — 미채택.
- **h1(57)**: 뾰족 A 다리가 말풍선 프레임과 융합, 16px에서 'AR' 오독 — A 실루엣 훼손 탈락.
- **h3(64)**: door leaf 경사면이 A 우각(右腳)을 지우고 16px에서 A가 반쪽화 — '열림' 서사 대비 비용 과다.
- zoom16 순위: h2 > h4 > h4_mini > h3 > h1. BASE g3/g6 대비: 서사(I+버블)는 h2만 온전, 순수 마크
  견고성은 g3≈h2. 추천: **h2_roundA_i_bubble** 확정 후보, h4는 미니멀 파비콘 대안.

## 사고 1건 (원인/조치/재발방지)
1. **Recraft 크레딧 소진 3라운드 연속 지속**: probe 1회 실호출로 400 not_enough_credits 원문 확인
   (rc_log.jsonl). 조치: 전원 NB 5회로 라운드 완수(교차 채택 목표는 크레딧 충전 후 회차 보강).
   재발방지: 라운드 착수 전 크레딧 잔액 조회 엔드포인트가 404(미제공)라 실호출 probe가 유일한
   검증 수단 — probe를 1회로 상한 두고(실패 시 즉시 NB 전환) Rounds 스크립트에 고정.

## 파일
- gen_round17_nb.py — 4변주 브리프 원문 내장, probe_round17.py — h4_mini+RC 크레딧 probe(원문 로그)
- build_check_round17.py — 5안 빌드+게이트 + R16 BASE 2행 병기 비교시트
- comparison-sheet-round17.png — BASE2+5안 (1024/64/32/16/on-dark)
- zoom17.py / zoom16-round17.png — 파비콘 16px x16 확대 정밀 QC 시트
- final/ — 안당 master1024/fav16·32·64/transparent (총 25파일)
- drafts_nb/ — NB 원본 5장

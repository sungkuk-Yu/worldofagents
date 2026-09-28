# Round 19 — g3 기준 'A 머리 넓히기 + i 일직선화' 3변주 (t_b3f4c45a, 2026-09-28)

대표님 9/28 원문: "아니 그냥 이게 좋다. 에이 안에 아이처럼 보이면서 그 안에 채팅 버블이 있고 너무
찬찬해. 근데 위에 에이의 머리 측면이 좀 더 넓고, 안에 있는 i가 좀 더 일직선처럼 수정됐으면 좋겠다.
에이가 양옆으로 공간을 좀 더 넓혀야 가능하지" — 기준안 = selected/AT-mark-g3_roundA(R16 g3).
R18 변주(k1 등)가 아닌 g3 골격 자체의 2개 지시 교정: (1) 상단 1/3 좌우 폭 15~20% 확대(어깨 넓힘),
(2) 흰 카운터를 수직 정렬 직선 i로, 말풍선 꼬리는 i 아래 끝에 한 번.

## 규율 (Round 13-18 계승)
- 생성형 필수(수작업 SVG 조판 0회): Nano Banana(gemini-3.1-flash-image) 3회 실생성 전원 성공.
  Recraft probe 1회(상한 규정) → **400 not_enough_credits 5라운드 연속 확인**(rc_log.jsonl 원문).
- 2색 #00A86B+white 게이트 전원 off-palette 0.00%, prompt ≤1000자 사전 assert(m1 995/m2 994/m3 948).
- 사고 1건: m1 브리프 최초 1061자 → assert가 API 호출 전 차단, 2단계 압축(1013→1001→995) 후 통과.
  재발방지(R18 계승): HARD+NEG 상수(≈390자) 잔여 예산에서 역산.
- 프롬프트 원문 nb_log.jsonl / rc_log.jsonl 법무 추적

## 3안 (final/, 게이트 전원 off-palette 0.00%)
| 안 | 변주 의도 | ink@16px |
|---|---|---|
| m1_widehead_straighti | 지시 그대로: 넓은 어깨 + i 카운터(꼬리 아래 1회) | 104 |
| m2_widehead_big_i | 머리 확장분만큼 i도 크게 — 넓은 머리·큰 i 비례 동조 | 107 |
| m3_widehead_pure_i | 대조군: 머리 넓힘 + 꼬리 제거 순수 i 직립 | 122 |

BASE 행 = selected g3_roundA(ink 96) — 시트 최상단 병기.

### 심사 코멘트 (comparison + zoom16-round19.png x16 확대 QC)
- **m2_widehead_big_i 통과본(추천)**: 지시 2건 동시 충족 — 꼭대기가 플랫블런트로 넓어져(어깨≈전체
  폭) '양옆 공간' 확보, 카운터가 곧은 수직 직사각 i 하나 + 꼬리는 아래 끝 우측 한 번. 16px에서
  흰 i 바가 또렷한 세로선으로 남고 A 판독 유지(BASE 대비 머리 확장이肉眼으로 명확).
  미세 결함: 상단이 다소 평평해 Π 경계(다리의 외벌림이 A로 복원).
- m1(104): i 판독은 최강(점+몸통 = 문자 그대로의 'i')하나 카운터가 2개 void로 갈라져 'ONE
  counter' 골격 이탈, 어깨에 외곽 단차(버섯 목) 발생 — 구성 결함으로 기각.
- m3(122): 대조군 의도대로 꼬리 제거 시 '채팅 버블' 서사 소실 + 실루엣이 버섯/아치 오독 —
  대표님이 칭찬한 "그 안에 채팅 버블이 있고" 조건 위반 실증. 미채택.
- zoom16 A-판독 순위: **m2** > m1 > BASE ≈ m3. i 직선성: m1(분절) > m2 > m3(가늘어 소실 경계).

## 파일
- gen_round19_nb.py — 3변주 브리프 원문 내장 / probe_round19_rc.py — RC 크레딧 probe(원문 로그)
- build_check_round19.py — 3안 빌드+게이트 + BASE 행 병기 비교시트
- comparison-sheet-round19.png — BASE1+3안 (1024/64/32/16/on-dark)
- zoom19.py / zoom16-round19.png + letterref-HOA.png — 16px x16 확대 QC
- final/ — 안당 master1024/fav16·32·64/transparent (총 15파일) / drafts_nb/ — NB 원본 3장
- selected/: m2 통과본을 **AT-mark-m2_widehead_{master1024,favicon16,favicon32,favicon64,
  transparent}.png** 로 추가 등재. g3 5종은 BASE 참조용으로 유지(기존 스크립트 경로 호환) —
  대표님 승인 시 g3를 교체 아카이브할 것. 최종 확정 아님.

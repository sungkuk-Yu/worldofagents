# Round 9 — 대문자 "AT" 타이포 마크 3안 (t_78c96450, 2026-09-28)

대표님 정정(9/28): "대문자로 AT로 해야 할 거 같은데, 너무 별러야. 소문자는 자신감 없어 보여"
— Round 8 소문자 'at' 3안 기각·폐기, **Round 9 = 대문자 AT**.
생성형 AI 원칙 유지: 나노바나나/Recraft 일절 배제, fontTools+SVG 코드로 수작업 조판.

## 저작·권원 근거

- 타입 소스: Pretendard Variable (orioncactus), SIL OFL 1.1 — 글리프 경로 베이크 허용
  (라이선스: `apps/mobile/MyAgentTalk/assets/fonts/Pretendard-OFL-LICENSE.txt`).
- 조합 설계는 인간 저작: 공용 획 DX=622(스캔라인 실측 근거), tie-bar 좌표·밴드, 트래킹 -80
  모두 build_round9.py에 좌표 주석. 생성형 AI 0회.
- 경계: 문자 자체(A, T)는 독점 불가 → 식별력은 조합·비례. 출원 전 키프리스/TMview 유사검색 필요.

## 3안 (전 안 wght900 — 대문자 특유의 무게감·자신감)

| 안 | 디렉터리 | 개념 | 기하 (폰트u, y-up 실측) |
|---|---|---|---|
| 1 | `opt1_at_ligature/` | A 우측 대각획이 T 세획을 겸하는 결합자 — Round8 opt1의 대문자 버전. 대문자 A의 각획이 스템에 파묻혀 한 몸 | T를 DX=622 이동 → 스템 [1114,1664]; 각획 외변 1522@y0·1334@y571·1124@y1200이 스템 좌변과 겹침, T 바(1172~1448)가 A 우견과 연속 |
| 2 | `opt2_at_tie_bar/` | A·T 간격 0 + T 크로스바를 A 가로대와 같은 높이 밴드로 잇는 변주 | DX=1468.27 (A 우 bbox 1523.74 − T 좌 bbox 55.47); 연결대 y310~571(A 가로대 밴드)×x1330→2332(스템 우변) |
| 3 | `opt3_at_wordmark/` | 따옴표 없는 볼드 `AT` 워드마크형 — 가장 보수적 정통 | 트래킹 -80 (대문자 A 각획 우하 vs T 바 좌단 광학 보정) |

## 하드 게이트 (전 안 통과)

- 2색 #00A86B+흰색: 전 PNG 화소 보간선 클램프, 이탈 0.0000% — `check_palette_round9.py` PASS
- 16px 판독: favicon16 10배 확대 육안 QC — 안1 결합자/안2 AT+바/안3 AT 모두 식별 가능
- 일러스트 금지·글자만: 글리프 아웃라인 + 안2 연결대 1개(타이포 구조물)뿐
- 생성형 AI 배제: 파이프라인 = fontTools → SVG path → cairosvg, 이미지 생성 모델 0회

## 안당 16파일 구조 (Round 8과 동일 규격)

- `master.svg` 초록마크/투명 · `master-inverted.svg` 흰마크/투명 · `mark-transparent-1024.png`
- `favicon/` favicon.svg + favicon16/32/64.png (흰지판 초록마크 = 16px 판독 통과본)
- `appicon/` appicon-white-{1024,512,180,120}.png · appicon-green-{…} · appicon-adaptive-fg-1024.png

## 빌드/검증

- `build_round9.py` — 글리프 추출·3안 조판·16파일×3 산출·2색 클램프
- `build_sheet_round9.py` — `comparison-sheet-round9.png` (1024 흰지판 + 64/32/16 실측열)
- `check_palette_round9.py` — 2색 이탈 게이트 (≤0.01% = PASS)

## Round 8 대비 설계 판단

- 소문자 @ 마크안(Round8 opt2)은 대문자 대응물 없음 — 대표님 "AT 표기" 지시에 따라 3안 전부 A·T 글리프 조합으로 재구성.
- 안1은 소문자판과 달리 크로스바 재드로잉 불필요: 대문자 T 스템 자체가 A 각획과 fusion.
- 안2 연결대는 A 가로대 실측 우단(1334@y571)보다 4u 안쪽(1330)에서 시작해 이음새 없음.

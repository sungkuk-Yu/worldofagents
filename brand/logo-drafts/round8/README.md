# Round 8 — 'at' 타이포그래피 마크 3안 (t_4bc5167c, 2026-09-28)

대표님 결정(9/28): 생성형 로고 라인 중단, 'at' 타이포그라피 마크로 pivot.
**생성형 AI 나노바나나/Recraft 일절 배제** — 마크는 fontTools+SVG 코드로 수작업 조판.
Round7 96파일은 폐기 아닌 보관 (git main `003a6856`).

## 저작·권원 근거 (상표 대비용)

- **타입 소스**: Pretendard Variable (Kil Hyung-jin / orioncactus), **SIL Open Font License 1.1**
  — 상업적 사용·변형·재배포 허용(라이선스 원문: `apps/mobile/MyAgentTalk/assets/fonts/Pretendard-OFL-LICENSE.txt`).
  OFL은 서체 파일 자체의 독점 재배포만 금지하며, 글리프를 경로로 추출해 로고로 박아 쓰는 것은 허용.
  Reserved Font Name(Pretendard)을 제품/서체 이름으로 쓰지 않으므로 위반 없음.
- **조합 설계는 인간 저작**: 리거처 스템 공유 좌표(DX=542, 스템 좌측변 정렬), @ 카운터 재조판
  스케일/위치, 트래킹(-50/2048 em) 모두 계산·시각 QC로 결정 — build_round8.py에 좌표·근거 주석.
  AI 생성물이 아니므로 "인간 저작" 요건 문제없음 = 저작권 등록·상표 출원 경로 클린.
- **경계**: 문자 자체(a, t, @)는 독점 불가 → 식별력은 조합·비례에 걸림. 타사 'at'/@ 로고
  (예: 기존 @계 브랜드) 선등록 여부는 출원 전 키프리스/TMview 유사검색 필요 (본 카드 범위 외).

## 하드 게이트 (전 안 통과)

- 2색 #00A86B+흰색: 전 PNG 화소를 보간선 클램프, 이탈 0.0000% (r8_palette.py 게이트 PASS)
- 16px 판독: favicon16 실측에서 3안 모두 'at'/@ 식별 가능 (비교시트 하단 1:1 실측열)
- 일러스트 금지·글자/기호만: 글리프 아웃라인과 공용 스템 정사각 팔 1개(타이포 구조물)뿐
- 생성형 AI 배제: 산출 파이프라인 = fontTools → SVG path → cairosvg, 이미지 생성 모델 0회

## 3안

| 안 | 디렉터리 | 개념 | 타이포 |
|---|---|---|---|
| 1 | `opt1_at_ligature/` | a 우측 스템을 t 스템으로 공용 — 한 글자처럼 붙되 각자 판독 | Pretendard 800 |
| 2 | `opt2_at_sign/` | at 싸인이 곧 @ — 원 안 카운터를 이중층 a로 재조판, mention 의미와 직결 | Pretendard 800 |
| 3 | `opt3_at_wordmark/` | 따옴표 없이 `at` 두 글자, 자소 폭·간격만 손터닝 — 가장 보수적 | Pretendard 900 |

## 안당 16파일 구조

- `master.svg` 초록마크/투명 · `master-inverted.svg` 흰마크/투명 · `mark-transparent-1024.png`
- `favicon/` favicon.svg + favicon16/32/64.png (흰지판 초록마크 = 16px 판독 통과본)
- `appicon/` appicon-white-{1024,512,180,120}.png 흰지판초록 · appicon-green-{…} 초록지판흰 ·
  appicon-adaptive-fg-1024.png (애뎁티브 전경: 흰마크/투명bg)

## 빌드/검증

- `build_round8.py` — 글리프 추출·3안 조판·16파일×3 산출·2색 클램프
- `build_sheet_round8.py` — `comparison-sheet-round8.png` (1024 양지판 + 64/32/16 실측열)
- 2색 이탈 게이트: scratch/r8_palette.py (전 화소 보간선 이탈 ≤0.01% = PASS)
- 참고: 안1 크로스바는 cairosvg clipPath y-flip 버그로 폰트 크로스바 우반분 팔을
  동일 밴드(y 838~1086)에 직접 드로잉 — 시각적으로 폰트 크로스바와 구분 불가

# Round7 자산화 세트 (t_bdd14184, 2026-09-28)

안 선택 유보 — 나노바나나 3안(nb_*)·Recraft 3안(rc_*) 전부 자산화. 2색 #00A86B+흰색 엄수.

- favicon/ : 16·32·64 (Round7 16px 판독 게이트 통과본 = final/*_faviconN.png)
- appicon/ : 스토어 마스터 1024 + 512/180/120. appicon-white=흰지판 초록마크,
  appicon-green=초록지판 흰마크(단색 반전). adaptive-fg=흰마크/투명bg — 안드로이드
  애뎁티브 전경 레이어(A·I 간격 트릭은 투명이라 배색 bg 색이 틈으로 읽힘).
  iOS는 흰지판 판이 흰 배경에서 묻히면 초록지판(appicon-green) 권장.
- wordmark/ : 마크타일+Pretendard 700 타이포. en/ko × white(흰지판·초록타이포)/green(초록지판·흰타이포).
- 파비콘은 마크만 사용(전용 면), 워드마크는 지판 색과 같이 배포.
- 원본: ../final/ · Recraft SVG: ../drafts_rc/*.svg · 빌드: build_assets_round7.py

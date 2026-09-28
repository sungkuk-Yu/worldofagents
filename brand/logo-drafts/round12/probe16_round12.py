#!/usr/bin/env python3
"""16px 실측 판독 보조: favicon16의 초록/흰 분포 + I·A 스템 열 존재 확인."""
import os
from PIL import Image
OUT = '/home/holysky87/worldofagents/brand/logo-drafts/round12'
names = ['v0_base1b_AI', 'v1_tails_cross', 'v2_lens_dot', 'v3_humanI']
for name in names:
    im = Image.open(os.path.join(OUT, name, 'favicon', 'favicon16.png')).convert('RGB')
    px = im.load()
    def green(x, y):
        r, g, b = px[x, y]; return g > 120 and r < 120
    # 16px 스케일 = 1024/16 = 64px/px. A 다리(흰) 열 x≈(250..300)/64≈4, I 스템(초록) x≈(774..864)/64≈12-13
    a_col_white = sum(1 for y in range(16) if not green(4, y))
    i_col_green = sum(1 for y in range(16) if green(12, y))
    lens_green = sum(1 for y in range(16) for x in range(7, 10) if green(x, y))
    print(f'{name}: col4 white-run(A다리)={a_col_white} col12 green-run(I스템)={i_col_green} lens cols7-9 green={lens_green}/48')

#!/usr/bin/env python3
"""Round12 비교시트: 1b 골격 v0 + 발전 3변주 (× 1024 / 64 / 32 / 16 실측)."""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = '/home/holysky87/worldofagents/brand/logo-drafts/round12'
FONT = '/home/holysky87/worldofagents/apps/mobile/MyAgentTalk/assets/fonts/PretendardVariable.ttf'
GREEN = (0, 168, 107); RED = (200, 60, 60)

OPTS = [
    ('v0_base1b_AI/appicon/appicon-white-1024.png', 'v0. 1b 골격 (기준선)', '좌 초록square+A · 우 흰round+I · 꼬리 상호향', '기준', False),
    ('v1_tails_cross/appicon/appicon-white-1024.png', 'v1. 꼬리 교차', '두 꼬리 X교차 — 서로를 향한 대화 극대화', '발전안', True),
    ('v2_lens_dot/appicon/appicon-white-1024.png', 'v2. 렌즈 접점', 'vesica 안 흰 점=교감 정점 · 16px 소멸', '발전안', True),
    ('v3_humanI/appicon/appicon-white-1024.png', 'v3. 둥근 I', 'I 세리프 스타디움화=사람 암시 · A 각질 유지', '발전안', True),
]

f_title = ImageFont.truetype(FONT, 52); f_title.set_variation_by_axes([800])
f_lab = ImageFont.truetype(FONT, 30); f_lab.set_variation_by_axes([600])
f_sm = ImageFont.truetype(FONT, 24); f_sm.set_variation_by_axes([400])

CELL = 500; PAD = 40; ROWH = CELL + 200
W = PAD * 2 + CELL * 4
H = 160 + ROWH + PAD
sheet = Image.new('RGB', (W, H), (248, 250, 251))
d = ImageDraw.Draw(sheet)
d.text((PAD, 40), 'Logo Round 12 — 1b(AI) 기반 상징 발전 3변주 (A=에이전트 초록 square · I=인간 흰 round)', font=f_title, fill=(30, 35, 40))
d.text((PAD, 104), '11-Fix 수치 골격 그대로(중심 y512 · 중첩 330 · vesica 초록 · 2색 #00A86B+흰) · 변주는 상호향·접점·타이포 형태만 · 생성형 0회 수작업 SVG', font=f_sm, fill=(110, 120, 130))

for i, (rel, label, sub, tag, own) in enumerate(OPTS):
    x = PAD + i * CELL
    y = 160
    src = Image.open(os.path.join(OUT, rel)).convert('RGB')
    big = src.resize((CELL - 24, CELL - 24), Image.LANCZOS)
    sheet.paste(big, (x + 12, y))
    d.text((x + 12, y + CELL - 4), label, font=f_lab, fill=GREEN if own else (90, 100, 110))
    d.text((x + 12, y + CELL + 34), sub, font=f_sm, fill=(90, 100, 110))
    d.text((x + 12, y + CELL + 66), tag, font=f_sm, fill=(GREEN if own else RED))
    sx = x + 12; sy = y + CELL + 104
    for sz in (64, 32, 16):
        chip = src.resize((sz, sz), Image.LANCZOS)
        sheet.paste(chip, (sx, sy + (64 - sz) // 2))
        d.rectangle([sx - 1, sy - 1, sx + sz, sy + 64], outline=(210, 216, 222))
        sx += sz + 16
    d.text((x + 12, sy + 80), '64 / 32 / 16 실측 (1:1 픽셀)', font=f_sm, fill=(140, 148, 156))

sheet.save(os.path.join(OUT, 'comparison-sheet-round12.png'))
print('sheet', sheet.size)

#!/usr/bin/env python3
"""Round10 비교시트: 4안 × (1024 흰지판 / 64 / 32 / 16 실축소) + 상징 해설 1줄 + 16px 판독 판정."""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = '/home/holysky87/worldofagents/brand/logo-drafts/round10'
FONT = '/home/holysky87/worldofagents/apps/mobile/MyAgentTalk/assets/fonts/PretendardVariable.ttf'
GREEN = (0, 168, 107); RED = (200, 60, 60)

OPTS = [
    ('opt1_at_roundat', '1. AT→@ 원형화', 'A=@ 안쪽 a · T 바→환', 'PASS 16px @+A', True),
    ('opt2_speech_counter', '2. 말풍선 카운터', 'A 구멍에 말풍선 꼬리', 'PASS 16px AT', True),
    ('opt3_negative_at', '3. 부정공간 @', 'T 바에 흰 @ 천공', 'FAIL 16px @ 소실', False),
    ('opt4_t_speech_arrow', '4. T=말대', 'T 바→화살+꼬리', 'FAIL 16px AT 난독', False),
]

f_title = ImageFont.truetype(FONT, 56); f_title.set_variation_by_axes([800])
f_lab = ImageFont.truetype(FONT, 34); f_lab.set_variation_by_axes([600])
f_sm = ImageFont.truetype(FONT, 26); f_sm.set_variation_by_axes([400])

CELL = 460; PAD = 48; ROWH = CELL + 210
W = PAD * 2 + CELL * 4
H = 170 + ROWH + 130 + PAD
sheet = Image.new('RGB', (W, H), (248, 250, 251))
d = ImageDraw.Draw(sheet)
d.text((PAD, 48), 'Logo Round 10 — "AT" 이중판독 상징 마크 4안 (@·말풍선 내재화)', font=f_title, fill=(30, 35, 40))
d.text((PAD, 118), 'Pretendard wght900 아웃라인 + SVG 수작업 · 생성형 AI 0회 · 2색 #00A86B+흰색 · 16px 게이트: 탈락안 표기', font=f_sm, fill=(110, 120, 130))

for i, (name, label, sub, verdict, ok) in enumerate(OPTS):
    x = PAD + i * CELL
    y = 170
    big = Image.open(os.path.join(OUT, name, 'appicon', 'appicon-white-1024.png')).convert('RGB').resize((CELL - 24, CELL - 24), Image.LANCZOS)
    sheet.paste(big, (x + 12, y))
    d.text((x + 12, y + CELL - 4), label, font=f_lab, fill=GREEN)
    d.text((x + 12, y + CELL + 38), sub, font=f_sm, fill=(90, 100, 110))
    d.text((x + 12, y + CELL + 72), verdict, font=f_sm, fill=(GREEN if ok else RED))
    sx = x + 12; sy = y + CELL + 118
    src = Image.open(os.path.join(OUT, name, 'appicon', 'appicon-white-1024.png')).convert('RGB')
    for sz in (64, 32, 16):
        chip = src.resize((sz, sz), Image.LANCZOS)
        sheet.paste(chip, (sx, sy + (64 - sz) // 2))
        d.rectangle([sx - 1, sy - 1, sx + sz, sy + 64], outline=(210, 216, 222))
        sx += sz + 18
    if not ok:
        d.line([sx - 40, sy + 32, sx + 10, sy + 32], fill=RED, width=4)
    d.text((x + 12, sy + 80), '64 / 32 / 16 실측 (1:1 픽셀)', font=f_sm, fill=(140, 148, 156))

sheet.save(os.path.join(OUT, 'comparison-sheet-round10.png'))
print('sheet', sheet.size)

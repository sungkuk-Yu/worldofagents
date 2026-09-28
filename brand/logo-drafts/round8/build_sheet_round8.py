#!/usr/bin/env python3
"""Round8 비교시트: 3안 × (1024 흰지판 / 1024 초록지판 / 64 / 32 / 16 실축소) + 라벨."""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = '/home/holysky87/worldofagents/brand/logo-drafts/round8'
FONT = '/home/holysky87/worldofagents/apps/mobile/MyAgentTalk/assets/fonts/PretendardVariable.ttf'
GREEN = (0, 168, 107)

OPTS = [('opt1_at_ligature', '1. at 리거처', 'a·t 스템 공용 (wght800)'),
        ('opt2_at_sign', '2. @ 마크', '카운터를 이중 a로 (wght800)'),
        ('opt3_at_wordmark', '3. at 볼드 워드마크형', '타이트 트래킹 (wght900)')]

f_title = ImageFont.truetype(FONT, 56); f_title.set_variation_by_axes([800])
f_lab = ImageFont.truetype(FONT, 34); f_lab.set_variation_by_axes([600])
f_sm = ImageFont.truetype(FONT, 26); f_sm.set_variation_by_axes([400])

CELL = 460; PAD = 48; ROWH = CELL + 170
W = PAD * 2 + CELL * 3
H = 170 + ROWH + 130 + PAD
sheet = Image.new('RGB', (W, H), (248, 250, 251))
d = ImageDraw.Draw(sheet)
d.text((PAD, 48), 'Logo Round 8 — "at" 타이포 마크 3안 (SVG 수작업)', font=f_title, fill=(30, 35, 40))
d.text((PAD, 118), 'Pretendard Variable (SIL OFL 1.1) 아웃라인 베이크 · 2색 #00A86B+흰색 · 16px 판독 게이트 통과', font=f_sm, fill=(110, 120, 130))

for i, (name, label, sub) in enumerate(OPTS):
    x = PAD + i * CELL
    y = 170
    big = Image.open(os.path.join(OUT, name, 'appicon', 'appicon-white-1024.png')).convert('RGB').resize((CELL - 24, CELL - 24), Image.LANCZOS)
    sheet.paste(big, (x + 12, y))
    d.text((x + 12, y + CELL - 4), label, font=f_lab, fill=GREEN)
    d.text((x + 12, y + CELL + 38), sub, font=f_sm, fill=(90, 100, 110))
    # shrink row: real 1024->N Lanczos, shown at native px on white chip
    sx = x + 12; sy = y + CELL + 84
    src = Image.open(os.path.join(OUT, name, 'appicon', 'appicon-white-1024.png')).convert('RGB')
    for sz in (64, 32, 16):
        chip = src.resize((sz, sz), Image.LANCZOS)
        sheet.paste(chip, (sx, sy + (64 - sz) // 2))
        d.rectangle([sx - 1, sy - 1, sx + sz, sy + 64], outline=(210, 216, 222))
        sx += sz + 18
    d.text((x + 12, sy + 80), '64 / 32 / 16 실측 (1:1 픽셀)', font=f_sm, fill=(140, 148, 156))

sheet.save(os.path.join(OUT, 'comparison-sheet-round8.png'))
print('sheet', sheet.size)

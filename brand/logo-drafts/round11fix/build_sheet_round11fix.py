#!/usr/bin/env python3
"""Round11-Fix 비교시트: 수치스펙 2변주 + Recraft 초안 3종 (× 1024 / 64 / 32 / 16 실측)."""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = '/home/holysky87/worldofagents/brand/logo-drafts/round11fix'
FONT = '/home/holysky87/worldofagents/apps/mobile/MyAgentTalk/assets/fonts/PretendardVariable.ttf'
GREEN = (0, 168, 107); RED = (200, 60, 60)

OPTS = [
    ('fix1a_bubbles_IA/appicon/appicon-white-1024.png', '1a. 수치스펙 IA (원판 앞)', '중심 y=512 일치 · 중첩 330 · 렌즈 초록 · 꼬리 상호향', '주안 후보', True),
    ('fix1b_bubbles_AI/appicon/appicon-white-1024.png', '1b. 수치스펙 AI (미러)', '좌 A·우 I — 표기 순서 변주', '주안 후보', True),
    ('drafts_rc/rc1_overlap_lens.png', 'rc1. Recraft 겹침+렌즈', '생성형 초안 — 균형 리서치 참고용', '참고', False),
    ('drafts_rc/rc2_lens_invert.png', 'rc2. Recraft 렌즈 반전', '생성형 초안', '참고', False),
    ('drafts_rc/rc3_tight_tails.png', 'rc3. Recraft 짧은 꼬리', '생성형 초안', '참고', False),
]

f_title = ImageFont.truetype(FONT, 52); f_title.set_variation_by_axes([800])
f_lab = ImageFont.truetype(FONT, 30); f_lab.set_variation_by_axes([600])
f_sm = ImageFont.truetype(FONT, 24); f_sm.set_variation_by_axes([400])

CELL = 500; PAD = 40; ROWH = CELL + 200
W = PAD * 2 + CELL * 5
H = 160 + ROWH + PAD
sheet = Image.new('RGB', (W, H), (248, 250, 251))
d = ImageDraw.Draw(sheet)
d.text((PAD, 40), 'Logo Round 11-Fix — 겹말풍선 균형 재조판: 수치 스펙 2변주 + Recraft 초안 3종', font=f_title, fill=(30, 35, 40))
d.text((PAD, 104), '수치 고정(동일 크기·y512 중심선·중첩 330·vesica 초록·꼬리 상호향) · 2색 #00A86B+흰 · rc*는 생성형 참고안(자산화 대상 아님)', font=f_sm, fill=(110, 120, 130))

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

sheet.save(os.path.join(OUT, 'comparison-sheet-round11fix.png'))
print('sheet', sheet.size)

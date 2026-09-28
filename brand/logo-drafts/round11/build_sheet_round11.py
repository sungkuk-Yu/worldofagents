#!/usr/bin/env python3
"""Round11 비교시트: 3안 × (1024 흰지판 / 64 / 32 / 16 실측) + 상징 해설 1줄 + 16px 판독 판정."""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = '/home/holysky87/worldofagents/brand/logo-drafts/round11'
FONT = '/home/holysky87/worldofagents/apps/mobile/MyAgentTalk/assets/fonts/PretendardVariable.ttf'
GREEN = (0, 168, 107); RED = (200, 60, 60)

OPTS = [
    ('opt1a_bubbles_IA', '1a. 겹말풍선 IA (주안)', '둥근판 I(사람) + 모난판 A(에이전트)', 'PASS 16px 두 판+I·A', True),
    ('opt1b_bubbles_AI', '1b. 겹말풍선 AI (주안 미러)', '좌 A·우 I — 표기 순서 변주', 'PASS 16px 두 판+A·I', True),
    ('opt2_question_arrow', '2. 물음표→대화살 (보조)', '? 원-스트로크가 회신 화살로 + AT', 'FAIL 16px 3분리 난독', False),
]

f_title = ImageFont.truetype(FONT, 56); f_title.set_variation_by_axes([800])
f_lab = ImageFont.truetype(FONT, 34); f_lab.set_variation_by_axes([600])
f_sm = ImageFont.truetype(FONT, 26); f_sm.set_variation_by_axes([400])

CELL = 620; PAD = 48; ROWH = CELL + 210
W = PAD * 2 + CELL * 3
H = 170 + ROWH + 130 + PAD
sheet = Image.new('RGB', (W, H), (248, 250, 251))
d = ImageDraw.Draw(sheet)
d.text((PAD, 48), 'Logo Round 11 — 인간↔에이전트 소통 상징: A·I 겹말풍선 (주안 2변주 + 보조)', font=f_title, fill=(30, 35, 40))
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

sheet.save(os.path.join(OUT, 'comparison-sheet-round11.png'))
print('sheet', sheet.size)

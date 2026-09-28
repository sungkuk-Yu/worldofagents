#!/usr/bin/env python3
"""Zoom 16px favicons x16 nearest for honest visual QC (Round 18), + A-reference row:
letter-form comparison strip (H / round-O / A / g3 / k0-k3) so the 'A로 읽히는가' label
QC is explicit (H/O/A 삼각 비교)."""
import os
sys_path = None
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__))
names = ['k0_flat_top', 'k1_dome_peak', 'k2_crossbar_bubble', 'k3_minimal_peak']
T = 256  # 16px * 16
W = (len(names) + 1) * (T + 20) + 20
sheet = Image.new('RGB', (W, T + 60), (245, 246, 247))
d = ImageDraw.Draw(sheet)
for i, n in enumerate(names):
    im = Image.open(os.path.join(HERE, 'final', f'{n}_favicon16.png')).convert('RGB')
    sheet.paste(im.resize((T, T), Image.NEAREST), (20 + i * (T + 20), 10))
    d.text((20 + i * (T + 20) + 4, T + 20), n, fill=(20, 24, 28))
# BASE g3 for continuity
im = Image.open(os.path.join(os.path.dirname(HERE), 'selected',
                             'AT-mark-g3_roundA_favicon16.png')).convert('RGB')
x = 20 + len(names) * (T + 20)
sheet.paste(im.resize((T, T), Image.NEAREST), (x, 10))
d.text((x + 4, T + 20), 'BASE g3_roundA', fill=(140, 60, 40))
sheet.save(os.path.join(HERE, 'zoom16-round18.png'))

# Reference strip: pure letterforms H / rounded O-dome / A drawn with PIL default font
REF = Image.new('RGB', (4 * 200, 200), (255, 255, 255))
dr = ImageDraw.Draw(REF)
try:
    f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 170)
except OSError:
    f = ImageFont.load_default()
for i, ch in enumerate(['H', 'O', 'A']):
    dr.text((i * 200 + 60, 0), ch, fill=(0, 168, 107), font=f)
REF.save(os.path.join(HERE, 'letterref-HOA.png'))
print('ok')

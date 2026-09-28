#!/usr/bin/env python3
"""Zoom 16px favicons x16 nearest for honest visual QC (Round 17)."""
import os
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__))
names = ['h1_a_door_i_bubble', 'h2_roundA_i_bubble', 'h3_halfopen_door', 'h4_negative_i', 'h4_negative_mini']
T = 256  # 16px * 16
W = (len(names) + 2) * (T + 20) + 20
sheet = Image.new('RGB', (W, T + 60), (245, 246, 247))
d = ImageDraw.Draw(sheet)
for i, n in enumerate(names):
    im = Image.open(os.path.join(HERE, 'final', f'{n}_favicon16.png')).convert('RGB')
    sheet.paste(im.resize((T, T), Image.NEAREST), (20 + i * (T + 20), 10))
    d.text((20 + i * (T + 20) + 4, T + 20), n, fill=(20, 24, 28))
# R16 baselines for continuity
for j, n in enumerate(['g3_f3_bubble_roundA', 'g6_f4_node_roundA']):
    im = Image.open(os.path.join(os.path.dirname(HERE), 'round16', 'final',
                                 f'{n}_favicon16.png')).convert('RGB')
    x = 20 + (len(names) + j) * (T + 20)
    sheet.paste(im.resize((T, T), Image.NEAREST), (x, 10))
    d.text((x + 4, T + 20), f'BASE {n}', fill=(140, 60, 40))
sheet.save(os.path.join(HERE, 'zoom16-round17.png'))
print('ok', sheet.size)

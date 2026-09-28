#!/usr/bin/env python3
"""Zoom 16px favicons x16 nearest for honest visual QC."""
import os
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
names = ['g1_f3_bubble_refine','g2_f3_bubble_bold16','g3_f3_bubble_roundA',
         'g4_f4_node_knob','g5_f4_node_mini','g6_f4_node_roundA']
T = 256  # 16px * 16
W = (len(names) + 2) * (T + 20) + 20
sheet = Image.new('RGB', (W, T + 60), (245, 246, 247))
from PIL import ImageDraw
d = ImageDraw.Draw(sheet)
for i, n in enumerate(names):
    im = Image.open(os.path.join(HERE, 'final', f'{n}_favicon16.png')).convert('RGB')
    sheet.paste(im.resize((T, T), Image.NEAREST), (20 + i * (T + 20), 10))
    d.text((20 + i * (T + 20) + 4, T + 20), n, fill=(20, 24, 28))
# baselines too
for j, n in enumerate(['f3_bubble_nb', 'f4_node_nb']):
    im = Image.open(os.path.join(os.path.dirname(HERE), 'round15', 'final', f'{n}_favicon16.png')).convert('RGB')
    x = 20 + (len(names) + j) * (T + 20)
    sheet.paste(im.resize((T, T), Image.NEAREST), (x, 10))
    d.text((x + 4, T + 20), f'BASE {n}', fill=(140, 60, 40))
sheet.save(os.path.join(HERE, 'zoom16-round16.png'))
print('ok', sheet.size)

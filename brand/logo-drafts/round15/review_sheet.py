#!/usr/bin/env python3
"""Round 15 raw review sheet: all rc svg + nb png tiles for visual judging."""
import os, io, sys
sys.path.append('/usr/lib/python3/dist-packages')
import cairosvg
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
T = 256
items = []
for f in sorted(os.listdir(os.path.join(HERE, 'drafts_rc'))):
    if f.endswith('.svg'):
        png = cairosvg.svg2png(url=os.path.join(HERE, 'drafts_rc', f),
                               output_width=T, output_height=T)
        items.append(('rc/' + f[:-4], Image.open(io.BytesIO(png)).convert('RGB')))
for f in sorted(os.listdir(os.path.join(HERE, 'drafts_nb'))):
    if f.endswith('.png'):
        items.append(('nb/' + f[:-4], Image.open(os.path.join(HERE, 'drafts_nb', f)).convert('RGB')))
cols = 4
rows = (len(items) + cols - 1) // cols
W = cols * (T + 20) + 20; H = rows * (T + 44) + 20
sheet = Image.new('RGB', (W, H), (245, 246, 247))
d = ImageDraw.Draw(sheet)
for i, (name, im) in enumerate(items):
    x = 20 + (i % cols) * (T + 20); y = 20 + (i // cols) * (T + 44)
    sheet.paste(im.resize((T, T), Image.LANCZOS), (x, y))
    d.text((x + 4, y + T + 6), name, fill=(20, 24, 28))
sheet.save(os.path.join(HERE, 'review-sheet-round15.png'))
print('review sheet:', len(items), 'tiles')

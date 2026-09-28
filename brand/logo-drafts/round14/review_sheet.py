#!/usr/bin/env python3
"""Contact sheet of all round14 drafts (6 RC + 12 NB) for judging."""
import os
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
TILE = 260; PAD = 14; LBL = 26
items = []
for f in sorted(os.listdir(os.path.join(HERE, 'drafts_rc'))):
    if f.endswith('.png'):
        items.append(('RC ' + f[:-4], os.path.join(HERE, 'drafts_rc', f)))
for f in sorted(os.listdir(os.path.join(HERE, 'drafts_nb'))):
    if f.endswith('.png'):
        items.append(('NB ' + f[:-4], os.path.join(HERE, 'drafts_nb', f)))
cols = 6
rows = (len(items) + cols - 1) // cols
W = cols * (TILE + PAD) + PAD
H = rows * (TILE + PAD + LBL) + PAD
sheet = Image.new('RGB', (W, H), (235, 236, 238))
from PIL import ImageDraw
d = ImageDraw.Draw(sheet)
for i, (name, path) in enumerate(items):
    r, c = divmod(i, cols)
    x = PAD + c * (TILE + PAD); y = PAD + r * (TILE + PAD + LBL)
    im = Image.open(path).convert('RGB').resize((TILE, TILE), Image.LANCZOS)
    sheet.paste(im, (x, y))
    d.text((x + 2, y + TILE + 4), name, fill=(20, 24, 28))
sheet.save(os.path.join(HERE, 'review-sheet-round14.png'))
print('ok', W, H, len(items))

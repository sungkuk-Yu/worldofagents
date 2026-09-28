#!/usr/bin/env python3
"""Round 17 build+check (t_a9997448) — pipeline identical to round16 (crop_square ->
clamp2 -> palette gate -> ink16 -> favicons/transparent -> comparison sheet).
NO hand-drawn geometry: only crop/resize of AI output. Sheet prepends the two R16
baseline masters (g3/g6 roundA) for continuity comparison."""
import os, sys
sys.path.append('/usr/lib/python3/dist-packages')
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SRCB = os.path.join(HERE, 'drafts_nb')
R16F = os.path.join(os.path.dirname(HERE), 'round16', 'final')
OUT = os.path.join(HERE, 'final'); os.makedirs(OUT, exist_ok=True)
GREEN = (0, 168, 107); WHITE = (255, 255, 255); TOL = 30

CANDS = [
 ('h1_a_door_i_bubble', 'nbpng', 'h1_a_door_i_bubble', SRCB),
 ('h2_roundA_i_bubble', 'nbpng', 'h2_roundA_i_bubble', SRCB),
 ('h3_halfopen_door',   'nbpng', 'h3_halfopen_door',   SRCB),
 ('h4_negative_i',      'nbpng', 'h4_negative_i',      SRCB),
 ('h4_negative_mini',   'nbpng', 'h4_negative_mini',   SRCB),
]

def load(kind, stem, src):
    import io, cairosvg
    if kind == 'rcsvg':
        png = cairosvg.svg2png(url=os.path.join(src, stem + '.svg'),
                               output_width=1024, output_height=1024)
        return Image.open(io.BytesIO(png)).convert('RGB')
    return Image.open(os.path.join(src, stem + '.png')).convert('RGB')

def crop_square(im, margin=0.08):
    g = im.convert('L'); px = g.load(); w, h = im.size
    xs = [x for x in range(w) for y in range(0, h, 4) if px[x, y] < 240]
    ys = [y for y in range(h) for x in range(0, w, 4) if px[x, y] < 240]
    if not xs or not ys: return im
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    side = max(x1 - x0 + 1, y1 - y0 + 1) * (1 + 2 * margin)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    return im.crop((cx - side/2, cy - side/2, cx + side/2, cy + side/2)).resize((1024, 1024), Image.LANCZOS)

def clamp2(im):
    g = im.convert('L'); out = Image.new('RGB', im.size)
    gp = g.load(); op = out.load()
    for y in range(im.height):
        for x in range(im.width):
            t = max(0.0, min(1.0, (gp[x, y] - 150) / (235 - 150)))
            op[x, y] = tuple(int(GREEN[i] + (WHITE[i] - GREEN[i]) * t) for i in range(3))
    return out

def palette_gate(im):
    small = im.resize((256, 256)); px = small.load(); bad = 0; n = 0
    for y in range(256):
        for x in range(256):
            r, g, b = px[x, y][:3]; n += 1
            ok = False
            for t in range(0, 101, 5):
                rr = GREEN[0] + (WHITE[0]-GREEN[0])*t//100
                gg = GREEN[1] + (WHITE[1]-GREEN[1])*t//100
                bb = GREEN[2] + (WHITE[2]-GREEN[2])*t//100
                if abs(r-rr) <= TOL and abs(g-gg) <= TOL and abs(b-bb) <= TOL:
                    ok = True; break
            if not ok: bad += 1
    return 100.0 * bad / n

def to_transparent(im):
    rgba = im.convert('RGBA'); px = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, a = px[x, y]
            if all(abs(c - w) <= 12 for c, w in zip((r, g, b), WHITE)):
                px[x, y] = (255, 255, 255, 0)
    return rgba

def ink16(im):
    f = im.resize((16, 16), Image.LANCZOS).convert('L')
    return sum(1 for p in f.getdata() if p < 200)

results = []
for name, kind, stem, src in CANDS:
    im = clamp2(crop_square(load(kind, stem, src)))
    im.save(os.path.join(OUT, f'{name}_master1024.png'))
    for s in (16, 32, 64):
        im.resize((s, s), Image.LANCZOS).save(os.path.join(OUT, f'{name}_favicon{s}.png'))
    to_transparent(im).save(os.path.join(OUT, f'{name}_transparent.png'))
    off = palette_gate(im); ink = ink16(im)
    results.append((name, off, ink))
    print(f'{name}: off-palette {off:.2f}%  ink@16px {ink}/256')

# baseline rows (R16 masters, gate only, no rebuild)
base = [('BASE g3_roundA(R16)', 'g3_f3_bubble_roundA_master1024.png'),
        ('BASE g6_roundA(R16)', 'g6_f4_node_roundA_master1024.png')]
base_imgs = []
for label, fn in base:
    im = Image.open(os.path.join(R16F, fn)).convert('RGB')
    base_imgs.append((label, im, palette_gate(im), ink16(im)))
    print(f'{label}: off-palette {base_imgs[-1][2]:.2f}%  ink@16px {base_imgs[-1][3]}/256')

S = 300; PAD = 24; LW = 620
W = LW + (S + PAD) * 2 + PAD; H = (S + PAD) * (len(results) + len(base_imgs)) + PAD
sheet = Image.new('RGB', (W, H), (245, 246, 247))
d = ImageDraw.Draw(sheet)
row = 0
for label, im, off, ink in base_imgs:
    y = PAD + row * (S + PAD)
    sheet.paste(im.resize((S, S), Image.LANCZOS), (PAD, y))
    d.text((PAD + S + 18, y + 8), label, fill=(140, 60, 40))
    d.text((PAD + S + 18, y + 30), f'off-palette {off:.2f}% · ink@16px {ink}/256', fill=(90, 96, 102))
    x = PAD + S + 18; yy = y + 60
    for s in (64, 32, 16):
        sheet.paste(im.resize((s, s), Image.LANCZOS), (x, yy)); x += s + 14
    tr = to_transparent(im).resize((90, 90), Image.LANCZOS)
    bg = Image.new('RGB', (90, 90), (60, 62, 66)); bg.paste(tr, (0, 0), tr)
    sheet.paste(bg, (x, yy))
    d.text((x, yy + 94), 'on dark', fill=(90, 96, 102))
    row += 1
for i, (name, kind, stem, src) in enumerate(CANDS):
    y = PAD + row * (S + PAD); row += 1
    master = Image.open(os.path.join(OUT, f'{name}_master1024.png'))
    sheet.paste(master.resize((S, S), Image.LANCZOS), (PAD, y))
    d.text((PAD + S + 18, y + 8), f'{name}  (Nano Banana · {stem})', fill=(20, 24, 28))
    _, off, ink = results[i]
    d.text((PAD + S + 18, y + 30), f'off-palette {off:.2f}% · ink@16px {ink}/256', fill=(90, 96, 102))
    x = PAD + S + 18; yy = y + 60
    for s in (64, 32, 16):
        sheet.paste(master.resize((s, s), Image.LANCZOS), (x, yy)); x += s + 14
    tr = Image.open(os.path.join(OUT, f'{name}_transparent.png')).resize((90, 90), Image.LANCZOS)
    bg = Image.new('RGB', (90, 90), (60, 62, 66)); bg.paste(tr, (0, 0), tr)
    sheet.paste(bg, (x, yy))
    d.text((x, yy + 94), 'on dark', fill=(90, 96, 102))
sheet.save(os.path.join(HERE, 'comparison-sheet-round17.png'))
print('sheet ok')
worst = max(r[1] for r in results)
print('GATE off-palette worst %.2f%% (limit 2.0%%)' % worst)

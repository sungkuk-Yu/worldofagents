#!/usr/bin/env python3
"""Round 13 build+check (t_59c343c7).
Shortlist 6 candidates (Recraft v4 / Nano Banana). Per candidate:
  master square (bbox-crop + 8% margin), favicon 16/32/64, transparent png,
  2-color palette gate (tolerance), 16px ink probe. Then comparison sheet.
NO hand-drawing of geometry — only crop/resize of AI output (policy: no manual SVG judging)."""
import os, io, sys
sys.path.append('/usr/lib/python3/dist-packages')
import cairosvg
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'drafts_rc'); SRCB = os.path.join(HERE, 'drafts_nb')
OUT = os.path.join(HERE, 'final')
os.makedirs(OUT, exist_ok=True)
GREEN = (0, 168, 107); WHITE = (255, 255, 255); TOL = 30

CANDS = [  # name, source ('rcsvg'|'rcpng'|'nbpng'), stem
 ('c1_knot_rc',    'rcsvg', 's6_knot_v2',        SRC),
 ('c2_wave_rc',    'rcsvg', 's4_wave_fountain_v2', SRC),
 ('c3_door_rc',    'rcsvg', 's5_open_door_v2',   SRC),
 ('c4_knot_nb',    'nbpng', 's6_knot_mini',      SRCB),
 ('c5_hand_nb',    'nbpng', 's1_handshake_mini', SRCB),
 ('c6_heads_nb',   'nbpng', 's2_two_heads_mini', SRCB),
]

def load(kind, stem, src):
    if kind == 'rcsvg':
        png = cairosvg.svg2png(url=os.path.join(src, stem + '.svg'),
                               output_width=1024, output_height=1024)
        return Image.open(io.BytesIO(png)).convert('RGB')
    return Image.open(os.path.join(src, stem + '.png')).convert('RGB')

def crop_square(im, margin=0.08):
    g = im.convert('L')
    px = g.load()
    w, h = im.size
    xs = [x for x in range(w) for y in range(0, h, 4) if px[x, y] < 240]
    ys = [y for y in range(h) for x in range(0, w, 4) if px[x, y] < 240]
    if not xs or not ys: return im
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    side = max(bw, bh) * (1 + 2 * margin)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    box = (cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2)
    return im.crop(box).resize((1024, 1024), Image.LANCZOS)

def clamp2(im):
    """Mechanical 2-color clamp: project every pixel onto the green<->white luminance
    axis (AI output sometimes renders a wrong-green). Geometry untouched."""
    g = im.convert('L'); out = Image.new('RGB', im.size)
    gp = g.load(); op = out.load()
    for y in range(im.height):
        for x in range(im.width):
            L = gp[x, y]
            t = max(0.0, min(1.0, (L - 150) / (235 - 150)))
            op[x, y] = tuple(int(GREEN[i] + (WHITE[i] - GREEN[i]) * t) for i in range(3))
    return out

def palette_gate(im):
    """% pixels outside {white, green} within TOL (anti-alias blends toward both allowed)."""
    small = im.resize((256, 256))
    px = small.load(); bad = 0; n = 0
    for y in range(256):
        for x in range(256):
            r, g, b = px[x, y][:3]; n += 1
            okw = all(abs(c - w) <= TOL for c, w in zip((r, g, b), WHITE))
            okg = all(abs(c - w) <= TOL for c, w in zip((r, g, b), GREEN))
            # blends on the white-green line are acceptable
            okb = False
            for t in range(0, 101, 5):
                rr = GREEN[0] + (WHITE[0]-GREEN[0])*t//100
                gg = GREEN[1] + (WHITE[1]-GREEN[1])*t//100
                bb = GREEN[2] + (WHITE[2]-GREEN[2])*t//100
                if abs(r-rr) <= TOL and abs(g-gg) <= TOL and abs(b-bb) <= TOL:
                    okb = True; break
            if not (okw or okg or okb): bad += 1
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
    off = palette_gate(im)
    ink = ink16(im)
    results.append((name, off, ink))
    print(f'{name}: off-palette {off:.2f}%  ink@16px {ink}/256')

# comparison sheet: rows=candidates, cols=1024/64/32/16 + transparent-on-grey
cols = [1024, 64, 32, 16]
S = 300; PAD = 24; LW = 620
W = LW + (S + PAD) * 2 + PAD; H = (S + PAD) * len(results) + PAD
sheet = Image.new('RGB', (W, H), (245, 246, 247))
from PIL import ImageDraw
d = ImageDraw.Draw(sheet)
for i, (name, kind, stem, src) in enumerate(CANDS):
    y = PAD + i * (S + PAD)
    master = Image.open(os.path.join(OUT, f'{name}_master1024.png'))
    big = master.resize((S, S), Image.LANCZOS)
    sheet.paste(big, (PAD, y))
    d.text((PAD + S + 18, y + 8), f'{name}  ({ "Recraft V4" if kind=="rcsvg" else "Nano Banana" } · {stem})', fill=(20, 24, 28))
    _, off, ink = results[i]
    d.text((PAD + S + 18, y + 30), f'off-palette {off:.2f}% · ink@16px {ink}/256', fill=(90, 96, 102))
    x = PAD + S + 18
    yy = y + 60
    for s in (64, 32, 16):
        f = Image.open(os.path.join(OUT, f'{name}_favicon{s}.png')).resize((s, s), Image.NEAREST) if False else master.resize((s, s), Image.LANCZOS)
        sheet.paste(f, (x, yy)); x += s + 14
    # transparent on checker-ish grey
    tr = Image.open(os.path.join(OUT, f'{name}_transparent.png')).resize((90, 90), Image.LANCZOS)
    bg = Image.new('RGB', (90, 90), (60, 62, 66)); bg.paste(tr, (0, 0), tr)
    sheet.paste(bg, (x, yy))
    d.text((x, yy + 94), 'on dark', fill=(90, 96, 102))
sheet.save(os.path.join(HERE, 'comparison-sheet-round13.png'))
print('sheet ok', os.path.join(HERE, 'comparison-sheet-round13.png'))
worst = max(r[1] for r in results)
print('GATE off-palette worst %.2f%% (limit 2.0%%)' % worst)

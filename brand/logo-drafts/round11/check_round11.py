#!/usr/bin/env python3
"""Round11 하드 게이트: (1) 2색 팔레트 이탈률 (2) 16px 판독 — 흰지판 실축소."""
import os
from PIL import Image

OUT = '/home/holysky87/worldofagents/brand/logo-drafts/round11'
G = (0, 168, 107); W = (255, 255, 255)

def dist_to_segment(p, a, b):
    ax, ay, az = a; bx, by, bz = b; px, py, pz = p
    dx, dy, dz = bx-ax, by-ay, bz-az
    L2 = dx*dx + dy*dy + dz*dz
    t = max(0.0, min(1.0, ((px-ax)*dx + (py-ay)*dy + (pz-az)*dz) / L2))
    return ((px-(ax+t*dx))**2 + (py-(ay+t*dy))**2 + (pz-(az+t*dz))**2) ** 0.5

worst = 0.0
for name in sorted(os.listdir(OUT)):
    d = os.path.join(OUT, name)
    if not os.path.isdir(d): continue
    for root, _, fs in os.walk(d):
        for f in sorted(fs):
            if not f.endswith('.png'): continue
            im = Image.open(os.path.join(root, f)).convert('RGBA')
            px = im.load(); n = im.width * im.height
            bad = sum(1 for y in range(im.height) for x in range(im.width)
                      if px[x, y][3] > 0 and dist_to_segment(px[x, y][:3], G, W) > 30)
            pct = 100.0 * bad / n
            worst = max(worst, pct)
            if pct > 0.01:
                print(f'FAIL {name}/{f}: {pct:.4f}%')
print(f'PALETTE WORST {worst:.4f}% ->', 'PASS' if worst <= 0.01 else 'FAIL')

# 16px ink coverage sanity (too-thin detail = illegible)
for name in sorted(os.listdir(OUT)):
    d = os.path.join(OUT, name)
    if not os.path.isdir(d): continue
    im = Image.open(os.path.join(d, 'favicon', 'favicon16.png')).convert('RGBA')
    px = im.load()
    ink = sum(1 for y in range(16) for x in range(16) if px[x, y][3] > 128)
    print(f'{name}: 16px ink {ink}/256 = {100*ink/256:.1f}%')

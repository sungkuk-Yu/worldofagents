#!/usr/bin/env python3
"""Round8 하드 게이트: 모든 화소는 #00A86B↔흰색 보간선상(안티얼라이언스 포함)이어야 한다.
이탈 비율 <= 0.01% = PASS (Round7 기준 동일)."""
import os
from PIL import Image

OUT = '/home/holysky87/worldofagents/brand/logo-drafts/round8'
G = (0, 168, 107); W = (255, 255, 255)

def dist_to_segment(p, a, b):
    ax, ay, az = a; bx, by, bz = b
    px, py, pz = p
    dx, dy, dz = bx-ax, by-ay, bz-az
    L2 = dx*dx + dy*dy + dz*dz
    t = max(0.0, min(1.0, ((px-ax)*dx + (py-ay)*dy + (pz-az)*dz) / L2))
    qx, qy, qz = ax + t*dx, ay + t*dy, az + t*dz
    return ((px-qx)**2 + (py-qy)**2 + (pz-qz)**2) ** 0.5

worst = 0.0
for name in sorted(os.listdir(OUT)):
    d = os.path.join(OUT, name)
    if not os.path.isdir(d): continue
    for root, _, fs in os.walk(d):
        for f in sorted(fs):
            if not f.endswith('.png'): continue
            p = os.path.join(root, f)
            im = Image.open(p).convert('RGBA')
            px = im.load()
            n = im.width * im.height
            bad = sum(1 for y in range(im.height) for x in range(im.width)
                      if px[x, y][3] > 0 and dist_to_segment(px[x, y][:3], G, W) > 30)
            pct = 100.0 * bad / n
            worst = max(worst, pct)
            flag = 'OK ' if pct <= 0.01 else 'FAIL'
            print(f'{flag} {name}/{os.path.relpath(p, d)}: deviation {pct:.4f}% ({bad}/{n})')
print(f'WORST {worst:.4f}% ->', 'PALETTE GATE PASS' if worst <= 0.01 else 'PALETTE GATE FAIL')

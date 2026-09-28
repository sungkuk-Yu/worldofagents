#!/usr/bin/env python3
"""Round12 게이트: (1) 2색 팔레트 이탈률 (2) 16px 실측 (3) 변주별 픽셀 검증.

픽셀 검증 (1024 appicon-white PNG, RGBA):
  공통 기하 (1b 네이티브): (372,512) 초록(A 홀) · (290,512) 흰(A 다리) ·
    (560,512) 초록(렌즈) · (809,512) 초록(I 스템) · (850,350) 흰(원판 우상)
  v1: 교차점 (408,863) 흰(round꼬리 전경) + (450,880) 초록(square꼬리, 흰 꼬리 밖)
  v2: (560,512) 흰(접점) / v0에선 같은 좌표 초록 — 대조 확인. (604,512) 초록(점 바깥)
  v3: 스타디움 코너 컷 — (700,367) 흰 / (720,367) 초록
"""
import os
from PIL import Image

OUT = '/home/holysky87/worldofagents/brand/logo-drafts/round12'
G = (0, 168, 107); W = (255, 255, 255)

def dist_to_segment(p, a, b):
    ax, ay, az = a; bx, by, bz = b; px, py, pz = p
    dx, dy, dz = bx-ax, by-ay, bz-az
    L2 = dx*dx + dy*dy + dz*dz
    t = max(0.0, min(1.0, ((px-ax)*dx + (py-ay)*dy + (pz-az)*dz) / L2))
    return ((px-(ax+t*dx))**2 + (py-(ay+t*dy))**2 + (pz-(az+t*dz))**2) ** 0.5

def is_green(px): return dist_to_segment(px, G, W) <= 30 and px[0] < 128
def is_white(px): return dist_to_segment(px, G, W) <= 30 and px[0] >= 128

names = ['v0_base1b_AI', 'v1_tails_cross', 'v2_lens_dot', 'v3_humanI']
fails = []

# 1) 팔레트 게이트
worst = 0.0
for name in names:
    d = os.path.join(OUT, name)
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
                fails.append(f'PALETTE {name}/{f}: {pct:.4f}%')
print(f'PALETTE WORST {worst:.4f}% ->', 'PASS' if worst <= 0.01 else 'FAIL')

# 2) 16px ink
for name in names:
    im = Image.open(os.path.join(OUT, name, 'favicon', 'favicon16.png')).convert('RGBA')
    px = im.load()
    ink = sum(1 for y in range(16) for x in range(16) if px[x, y][3] > 128)
    print(f'{name}: 16px ink {ink}/256 = {100*ink/256:.1f}%')

# 3) 변주 픽셀 검증
def big(name):
    im = Image.open(os.path.join(OUT, name, 'appicon', 'appicon-white-1024.png')).convert('RGB')
    return im.load()

common = [((372, 512), 'G', 'A 홀(초록)'), ((290, 512), 'W', 'A 다리(흰)'),
          ((560, 512), 'G', 'vesica 렌즈(초록)'), ((809, 512), 'G', 'I 스템(초록)'),
          ((850, 350), 'W', '원판 우상(흰)')]
for name in names:
    px = big(name)
    pts = [c for c in common if not (name == 'v2_lens_dot' and (x0 := c[0]) == (560, 512))]
    if name == 'v0_base1b_AI':
        pts += [((424, 870), 'W', 'round꼬리(흰)'), ((260, 830), 'G', 'square꼬리(초록)')]
    if name == 'v1_tails_cross':
        # 삼각형 경계 실측: white round꼬리(y870) 396..551, green square꼬리 383..418
        # → (410,870)=교차부 = 흰 round꼬리 전경 / square꼬리 emerging(white CB 밖):
        # y900 sq 451..462 vs white 364..407 → (455,900)=초록 노출
        pts += [((410, 870), 'W', '꼬리 교차부=흰 round꼬리 전경(square꼬리 덮음)'),
                ((455, 900), 'G', 'square꼬리 흰꼬리 밖 우하 노출(교차 후 재등장)')]
    if name == 'v2_lens_dot':
        pts += [((560, 512), 'W', '접점(흰)'), ((606, 512), 'G', '접점 바깥=렌즈 초록'),
                ((560, 470), 'G', '접점 위=렌즈 초록')]
    if name == 'v3_humanI':
        pts += [((700, 367), 'W', 'I 바 코너 컷(스타디움)'), ((720, 367), 'G', 'I 바 중심부(초록)')]
    for (x, y), exp, why in pts:
        if exp == 'x':  # 대조항은 아래 v2↔v0에서 별도 처리
            continue
        p = px[x, y]
        ok = is_white(p) if exp == 'W' else is_green(p)
        mark = 'PASS' if ok else 'FAIL'
        if not ok:
            fails.append(f'{name} ({x},{y}) expect {exp} got {tuple(p)} — {why}')
        print(f'{name} ({x},{y}) {exp} {why}: {mark}')

# v2 vs v0 대조: 렌즈 좌표 (560,512)는 v0 초록 → v2 흰
p0, p2 = big('v0_base1b_AI')[560, 512], big('v2_lens_dot')[560, 512]
print('dot-contrast v0(560,512)green/v2(560,512)white ->',
      'PASS' if is_green(p0) and is_white(p2) else f'FAIL {tuple(p0)} {tuple(p2)}')

# v2 16px = 점 소멸 → v0 16px와 동일 픽셀 (스펙: 16px는 무-점 판 배합)
i0 = Image.open(os.path.join(OUT, 'v0_base1b_AI', 'favicon', 'favicon16.png')).convert('RGB')
i2 = Image.open(os.path.join(OUT, 'v2_lens_dot', 'favicon', 'favicon16.png')).convert('RGB')
diff = sum(1 for y in range(16) for x in range(16) if i0.getpixel((x, y)) != i2.getpixel((x, y)))
print(f'v2 16px dot-vanish: diff px {diff}/256 ->', 'PASS' if diff <= 8 else 'FAIL')

print('=====')
if fails:
    print('GATE FAIL:'); [print(' -', f) for f in fails]
    raise SystemExit(1)
print('ALL GATES PASS')

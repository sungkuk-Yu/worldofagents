#!/usr/bin/env python3
"""Round 11-Fix (t_cde3ed12): 겹말풍선 균형 재조판 — 수치 스펙 고정, SVG 수작업.

대표님 9/28: "겹말풍선은 맞는거 같은데 왜 이렇게 디자인이 균형도 안맞고 중구난방이지"

고정 스펙 (카드 body, y-down 캔버스 1024):
  둥근판 r=330 중심(372,512) / 모난판 560x560 rx=96 중심(652,512)
  → 수평 중심선 y=512 완전 일치, 중심간격 280, 실제 x축 겹침폭 330 (x[372,702])
    (카드의 '겹침 영역 폭 280'은 고정 수치(중심·반지름)와 모순 — 중심간격 280을
     오기한 것으로 판정, 수치 우선. README 사고기록 기재.)
  중첩 렌더: 뒤 판 초록, 앞 판 흰+초록 2px 외곽선, 겹침 렌즈(vesica) 초록 유지 —
    흰/초록 음양 대비로 '교감'. 앞/뒤 문구가 '앞/뒤는 안…'에서 절단 → 두 변주 산출:
    1a 원판 앞(IA 독해), 1b 전체 x-미러(AI 독해). 미러 안전(글자 모두 좌우대칭).
  꼬리: 서로를 향해 — 원판 꼬리는 렌즈에서 우하로(사람→에이전트), 모난판 꼬리는
    바닥에서 좌하로(에이전트→사람), 두 꼬리가 중첩부 아래에서 마주봄.
  글자: I = 흰 반원판 가시영역 중심(215,512) 정중앙, 스템90·바230x70·h300.
    A = Pretendard wght900 아웃라인, 모난판 정중앙(652,512) s=0.221 (h≈320).
"""
import os, sys, math
sys.path.append('/usr/lib/python3/dist-packages')
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from PIL import Image
import cairosvg

FONT = '/home/holysky87/worldofagents/apps/mobile/MyAgentTalk/assets/fonts/PretendardVariable.ttf'
OUT = '/home/holysky87/worldofagents/brand/logo-drafts/round11fix'
SCRATCH = os.path.expanduser('~/.hermes/profiles/photo/cache/scratch')
GREEN = '#00A86B'
WHITE = '#FFFFFF'

f900 = instantiateVariableFont(TTFont(FONT), {'wght': 900}, inplace=False)
gs = f900.getGlyphSet(); cmap = f900.getBestCmap()

# ---- 기하 상수 (스펙 고정) ----
CX, CY, R = 372.0, 512.0, 330.0            # 둥근판 (사람)
SQ = (372.0, 232.0, 932.0, 792.0)          # 모난판 x0,y0,x1,y1 (560x560)
SQ_RX = 96.0
AS = 0.207                                  # A 스케일 (cap 1448 -> 300, I빔 높이와 동일 모자높이)

def circle(cx, cy, r):
    k = r * 4 * (math.sqrt(2) - 1) / 3
    return (f'M {cx-r:.2f} {cy:.2f} C {cx-r:.2f} {cy-k:.2f} {cx-k:.2f} {cy-r:.2f} {cx:.2f} {cy-r:.2f} '
            f'C {cx+k:.2f} {cy-r:.2f} {cx+r:.2f} {cy-k:.2f} {cx+r:.2f} {cy:.2f} '
            f'C {cx+r:.2f} {cy+k:.2f} {cx+k:.2f} {cy+r:.2f} {cx:.2f} {cy+r:.2f} '
            f'C {cx-k:.2f} {cy+r:.2f} {cx-r:.2f} {cy+k:.2f} {cx-r:.2f} {cy:.2f} Z')

def rrect(x0, y0, x1, y1, r):
    return (f'M {x0+r:.1f} {y0:.1f} L {x1-r:.1f} {y0:.1f} A {r:.1f} {r:.1f} 0 0 1 {x1:.1f} {y0+r:.1f} '
            f'L {x1:.1f} {y1-r:.1f} A {r:.1f} {r:.1f} 0 0 1 {x1-r:.1f} {y1:.1f} '
            f'L {x0+r:.1f} {y1:.1f} A {r:.1f} {r:.1f} 0 0 1 {x0:.1f} {y1-r:.1f} '
            f'L {x0:.1f} {y0+r:.1f} A {r:.1f} {r:.1f} 0 0 1 {x0+r:.1f} {y0:.1f} Z')

def poly(*pts):
    return 'M ' + ' L '.join(f'{x:.1f} {y:.1f}' for x, y in pts) + 'Z'

def rect(x0, y0, x1, y1):
    return poly((x0, y0), (x1, y0), (x1, y1), (x0, y1))

# A 아웃라인 (y-up 폰트u 실측, round11과 동일 좌표)
pen = SVGPathPen(gs); gs[cmap[ord('A')]].draw(pen)
A_TRAP = poly((45.4, 0), (526.4, 1448), (1042.8, 1448), (1523.7, 0))
A_HOLE = poly((630.1, 571.7), (938.8, 571.7), (784.5, 1059.3))
A_GAPQ = poly((456.1, 0), (1113.0, 0), (1026.0, 285.4), (542.9, 285.4))

def mark_inner():
    """y-down 캔버스 좌표. 층서: 모난판(뒤,초록) → 원판(앞,흰+초록2px) → 렌즈(초록) → 글자."""
    parts = []
    # 1) 모난판 꼬리: 바닥 우측에서 좌하 — 팁 (700,900), 에이전트가 원판을 향해 말함
    parts.append(f'<path d="{poly((760, 790), (840, 790), (700, 900))}" fill="{GREEN}"/>')
    # 2) 모난판 (뒤 판, 초록 단색)
    parts.append(f'<path d="{rrect(*SQ, SQ_RX)}" fill="{GREEN}"/>')
    # 3) 원판+꼬리 단일 경로 (외곽선 재봉합 — 이음새/교차 X자 제거):
    #    밑변 θ60°(537,798)→대아크→θ100°(315,837), 팁 (600,900) 우하 = 사람이 모난판을 향해 말함.
    #    꼬리 전체가 모난판 바닥(y792) 아래에 놓여 두 꼬리가 중첩부 정중앙 아래에서
    #    마주봄(팁 100px 이격, 교차 없음) — '서로에게 말한다'.
    bubble = 'M 537 798 A 330 330 0 1 0 315 837 L 600 900 Z'
    parts.append(f'<path d="{bubble}" fill="{WHITE}" stroke="{GREEN}" stroke-width="2"/>')
    # 5) 겹침 렌즈(vesica) = 모난판∩원판, 초록 유지 — 원판 흰 채움을 다시 덮음
    parts.append(f'<clipPath id="circ"><path d="{circle(CX, CY, R)}"/></clipPath>')
    parts.append(f'<path d="{rrect(*SQ, SQ_RX)}" fill="{GREEN}" clip-path="url(#circ)"/>')
    # 6) I빔 (초록) — 흰 반원판 가시영역 중심 (215,512), h300
    parts.append(f'<path d="{rect(160, 362, 250, 662)}" fill="{GREEN}"/>')
    parts.append(f'<path d="{rect(100, 362, 330, 432)}" fill="{GREEN}"/>')
    parts.append(f'<path d="{rect(100, 592, 330, 662)}" fill="{GREEN}"/>')
    # 7) A (흰) — 모난판 정중앙 (652,512). y-flip 후 폰트u 중심(784.55,724)을 원점으로
    T = f'translate(652 512) scale({AS} {-AS}) translate(-784.55 -724)'
    parts.append(f'<path d="{A_TRAP}" transform="{T}" fill="{WHITE}"/>')
    parts.append(f'<path d="{A_HOLE}" transform="{T}" fill="{GREEN}"/>')
    parts.append(f'<path d="{A_GAPQ}" transform="{T}" fill="{GREEN}"/>')
    return ''.join(parts)

def svg_doc(inner, size=1024, bg=None, mirror=False):
    if mirror:
        inner = f'<g transform="translate(1024 0) scale(-1 1)">{inner}</g>'
    bgrect = f'<rect width="{size}" height="{size}" fill="{bg}"/>' if bg else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">'
            '<!-- Round11-Fix t_cde3ed12 handcrafted · Pretendard A outline (SIL OFL 1.1) · fixed numeric spec -->'
            f'{bgrect}{inner}</svg>')

def invert_colors(s):
    ph = '__INV__'
    return s.replace(GREEN, ph).replace(WHITE, GREEN).replace(ph, WHITE)

def clamp_two_color(path):
    im = Image.open(path).convert('RGBA')
    px = im.load()
    gx, gy, gz = 0, 168, 107
    dx, dy, dz = 255 - gx, 255 - gy, 255 - gz
    L2 = dx * dx + dy * dy + dz * dz
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            t = ((r - gx) * dx + (g - gy) * dy + (b - gz) * dz) / L2
            t = 0.0 if t < 0 else (1.0 if t > 1 else t)
            px[x, y] = (round(gx + t * dx), round(gy + t * dy), round(gz + t * dz), a)
    im.save(path)

def emit_option(name, mirror):
    inner = mark_inner()
    d = os.path.join(OUT, name)
    os.makedirs(os.path.join(d, 'favicon'), exist_ok=True)
    os.makedirs(os.path.join(d, 'appicon'), exist_ok=True)
    master = svg_doc(inner, mirror=mirror)
    master_inv = invert_colors(master)
    white_tile = svg_doc(inner, bg=WHITE, mirror=mirror)
    green_tile = svg_doc(invert_colors(inner), bg=GREEN, mirror=mirror)
    open(os.path.join(d, 'master.svg'), 'w').write(master)
    open(os.path.join(d, 'master-inverted.svg'), 'w').write(master_inv)
    open(os.path.join(d, 'favicon', 'favicon.svg'), 'w').write(master)
    cairosvg.svg2png(bytestring=master.encode(), write_to=os.path.join(d, 'mark-transparent-1024.png'))
    cairosvg.svg2png(bytestring=white_tile.encode(), write_to=os.path.join(d, 'appicon', 'appicon-white-1024.png'))
    cairosvg.svg2png(bytestring=green_tile.encode(), write_to=os.path.join(d, 'appicon', 'appicon-green-1024.png'))
    for sz in (512, 180, 120):
        for kind in ('white', 'green'):
            Image.open(os.path.join(d, 'appicon', f'appicon-{kind}-1024.png')) \
                 .resize((sz, sz), Image.LANCZOS).save(os.path.join(d, 'appicon', f'appicon-{kind}-{sz}.png'))
    cairosvg.svg2png(bytestring=master_inv.encode(), write_to=os.path.join(d, 'appicon', 'appicon-adaptive-fg-1024.png'))
    base = Image.open(os.path.join(d, 'appicon', 'appicon-white-1024.png'))
    for sz in (64, 32, 16):
        base.resize((sz, sz), Image.LANCZOS).save(os.path.join(d, 'favicon', f'favicon{sz}.png'))
    for root, _, fs in os.walk(d):
        for f in fs:
            if f.endswith('.png'):
                clamp_two_color(os.path.join(root, f))
    print('emitted', name)

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    emit_option('fix1a_bubbles_IA', mirror=False)
    emit_option('fix1b_bubbles_AI', mirror=True)
    for name in ('fix1a_bubbles_IA', 'fix1b_bubbles_AI'):
        Image.open(os.path.join(OUT, name, 'appicon', 'appicon-white-1024.png')) \
             .convert('RGB').save(os.path.join(SCRATCH, f'r11fx_prev_{name}.png'))
        Image.open(os.path.join(OUT, name, 'favicon', 'favicon16.png')) \
             .convert('RGB').resize((160, 160), Image.NEAREST).save(os.path.join(SCRATCH, f'r11fx_f16_{name}.png'))
    print('previews done')

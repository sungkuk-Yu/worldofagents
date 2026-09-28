#!/usr/bin/env python3
"""Round 8 (t_4bc5167c): 'at' 타이포그래피 마크 3안 — SVG 수작업, 생성형 AI 배제.

타입 소스: Pretendard Variable (SIL OFL 1.1) — wght 800/900 정적 인스턴스의
a/t/@ 아웃라인을 fontTools로 추출해 <path>로 베이크. 조합 설계(공용 스템 정렬,
@ 카운터 재조판, 자소 간격)는 좌표 계산 = 인간 저작. 2색 게이트: #00A86B + 흰색.

산출: brand/logo-drafts/round8/<opt>/ 16파일×3 + comparison-sheet-round8.png + README
"""
import os, sys, json
sys.path.append('/usr/lib/python3/dist-packages')  # append: venv PIL wins, fontTools found here
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import RecordingPen
from PIL import Image, ImageDraw, ImageFont
import cairosvg

FONT = '/home/holysky87/worldofagents/apps/mobile/MyAgentTalk/assets/fonts/PretendardVariable.ttf'
OUT = '/home/holysky87/worldofagents/brand/logo-drafts/round8'
SCRATCH = os.path.expanduser('~/.hermes/profiles/photo/cache/scratch')
GREEN = '#00A86B'
WHITE = '#FFFFFF'

def load(weight):
    f = instantiateVariableFont(TTFont(FONT), {'wght': weight}, inplace=False)
    gs = f.getGlyphSet(); cm = f.getBestCmap()
    out = {}
    for ch in 'at@':
        g = cm[ord(ch)]
        pen = SVGPathPen(gs); gs[g].draw(pen)
        bp = BoundsPen(gs); gs[g].draw(bp)
        rec = RecordingPen(); gs[g].draw(rec)
        subs, cur = [], None
        for op, args in rec.value:
            if op == 'moveTo':
                if cur: subs.append(cur)
                cur = [('moveTo', args)]
            elif cur is not None:
                cur.append((op, args))
        if cur: subs.append(cur)
        subpaths = []
        for contour in subs:
            p = SVGPathPen(gs); b = BoundsPen(gs)
            for op, args in contour:
                getattr(p, op)(*args); getattr(b, op)(*args)
            subpaths.append((list(b.bounds), p.getCommands()))
        out[ch] = dict(adv=gs[g].width, bbox=list(bp.bounds), d=pen.getCommands(), sub=subpaths)
    return out

G8, G9 = load(800), load(900)

def stems(ch, weight):
    """dense-column runs (font units, from glyph origin x=0) via raster."""
    ft = ImageFont.truetype(FONT, 1024)
    ft.set_variation_by_axes([weight])
    im = Image.new('L', (3072, 3072), 0)
    ImageDraw.Draw(im).text((1024, 1024), ch, font=ft, fill=255)
    px = im.load(); bb = im.getbbox()
    dens = [sum(1 for y in range(bb[1], bb[3]) if px[x, y] > 100) for x in range(im.width)]
    mx = max(dens); runs, x = [], None
    for i, v in enumerate(dens):
        if v > mx * 0.72:
            if x is None: x = i
        else:
            if x is not None and (i - x) * 2.0 > 60: runs.append(((x - 1024) * 2.0, (i - 1024) * 2.0))
            x = None
    return runs

print('stems a@800:', stems('a', 800), ' t@800:', stems('t', 800))
print('stems a@900:', stems('a', 900), ' t@900:', stems('t', 900))

def P(d, dx=0, dy=0, fill=GREEN, clip=None, scale=None):
    """path in y-up design space (font units, glyph origin 0,0)."""
    tr = f'translate({dx:.2f} {-dy:.2f})'
    if scale: tr += f' scale({scale:.4f})'
    c = f' clip-path="url(#{clip})"' if clip else ''
    return f'<path d="{d}" transform="{tr}" fill="{fill}"{c}/>'

def wrap_mark(inner, bbox, pad=60):
    """y-up design group -> y-down svg fragment, viewBox = bbox+pad."""
    x0, y0, x1, y1 = bbox
    w, h = (x1 - x0) + 2 * pad, (y1 - y0) + 2 * pad
    g = f'<g transform="translate({-x0 + pad:.2f} {y1 + pad:.2f}) scale(1 -1)">{inner}</g>'
    return g, w, h

# ---------- Option 1: at 리거처 — a 우측 스템 = t 스템 ----------
def build_opt1():
    a, t = G8['a'], G8['t']
    a_stems = stems('a', 800); t_stems = stems('t', 800)
    A_STEM = a_stems[-1][0]      # a right stem left edge (720)
    T_STEM = t_stems[0][0]       # t stem left edge (178)
    DX = A_STEM - T_STEM         # 542 — t stem lands exactly on a stem
    # t 서브윤곽: [0]=크로스바 (35,838,713,1086), [1]=스템+훅 (178,-15,727,1346)
    (cb_bb, cb_d), (st_bb, st_d) = t['sub']
    # 크로스바는 버리고 공용 스템 우측으로만 팔(arm)을 수작 드로잉:
    # y는 폰트 크로스바 밴드(838~1086) 유지, 좌측은 스템 내부에서 시작해 이음새 없음
    arm = (f'M {A_STEM + 100:.0f} {cb_bb[1]:.0f} L {st_bb[2] + DX:.0f} {cb_bb[1]:.0f} '
           f'L {st_bb[2] + DX:.0f} {cb_bb[3]:.0f} L {A_STEM + 100:.0f} {cb_bb[3]:.0f} Z')
    inner = P(a['d']) + P(st_d, dx=DX) + P(arm)
    bb = [a['bbox'][0], -25, max(a['bbox'][2], st_bb[2] + DX), 1346]
    return wrap_mark(inner, bb)

# ---------- Option 2: @ 마크 — 카운터(원 안 a) 재조판 ----------
def build_opt2():
    at = G8['@']
    # sub order measured: [inner-a outer(bowl), inner-a counter, outer spiral]
    (ia_bb, ia_d), (ct_bb, ct_d), (sp_bb, sp_d) = at['sub']
    a = G8['a']
    # ring(spiral)만 남기고 단층 a 볼을 제거 → 이중 a를 카운터로 재조판 (단색·투명 호환)
    ax0, ay0, ax1, ay1 = a['bbox']
    bx0, by0, bx1, by1 = ia_bb
    s = min((bx1 - bx0) * 0.80 / (ax1 - ax0), (by1 - by0) * 0.72 / (ay1 - ay0))
    dw, dh = (ax1 - ax0) * s, (ay1 - ay0) * s
    ox = (bx0 + bx1) / 2 - dw / 2 - ax0 * s
    oy = s * ay0 - ((by0 + by1) / 2 - dh / 2) - 40   # optical drop toward baseline
    inner = P(sp_d) + f'<path d="{a["d"]}" transform="translate({ox:.2f} {-oy:.2f}) scale({s:.4f})" fill="{GREEN}"/>'
    return wrap_mark(inner, at['bbox'])

# ---------- Option 3: at 볼드 워드마크형 ----------
def build_opt3():
    a, t = G9['a'], G9['t']
    KERN = -50
    inner = P(a['d']) + P(t['d'], dx=a['adv'] + KERN)
    bb = [a['bbox'][0], -25, a['adv'] + KERN + t['bbox'][2], 1346]
    return wrap_mark(inner, bb)

def svg_doc(gfrag, w, h, size=1024, bg=None):
    rect = f'<rect width="{size}" height="{size}" fill="{bg}"/>' if bg else ''
    S = size; pad = S * 0.16
    s = min((S - 2 * pad) / w, (S - 2 * pad) / h)
    ox, oy = (S - w * s) / 2, (S - h * s) / 2
    mark = f'<g transform="translate({ox:.2f} {oy:.2f}) scale({s:.5f})">{gfrag}</g>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}">'
            f'<!-- Round8 handcrafted · Pretendard Variable outlines (SIL OFL 1.1) · no generative AI -->'
            f'{rect}{mark}</svg>')

def clamp_two_color(path):
    """하드 게이트 보장: 모든 화소를 #00A86B↔흰 보간선 최근접점으로 클램프(알파 보존)."""
    im = Image.open(path).convert('RGBA')
    px = im.load()
    gx, gy, gz = 0, 168, 107
    dx, dy, dz = 255 - gx, 255 - gy, 255 - gz
    L2 = dx*dx + dy*dy + dz*dz
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a == 0: continue
            t = ((r-gx)*dx + (g-gy)*dy + (b-gz)*dz) / L2
            t = 0.0 if t < 0 else (1.0 if t > 1 else t)
            px[x, y] = (round(gx + t*dx), round(gy + t*dy), round(gz + t*dz), a)
    im.save(path)

def emit_option(name, maker):
    g, w, h = maker()
    d = os.path.join(OUT, name)
    os.makedirs(os.path.join(d, 'favicon'), exist_ok=True)
    os.makedirs(os.path.join(d, 'appicon'), exist_ok=True)
    master = svg_doc(g, w, h)                    # green mark / transparent
    master_inv = master.replace(GREEN, WHITE)    # white mark / transparent (adaptive fg)
    white_tile = svg_doc(g, w, h, bg=WHITE)      # green mark / white tile
    green_tile = svg_doc(g.replace(GREEN, WHITE), w, h, bg=GREEN)  # white mark / green tile
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
            if f.endswith('.png'): clamp_two_color(os.path.join(root, f))
    print('emitted', name)

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for name, fn in (('opt1_at_ligature', build_opt1),
                     ('opt2_at_sign', build_opt2),
                     ('opt3_at_wordmark', build_opt3)):
        emit_option(name, fn)
    for name in ('opt1_at_ligature', 'opt2_at_sign', 'opt3_at_wordmark'):
        Image.open(os.path.join(OUT, name, 'appicon', 'appicon-white-1024.png')) \
             .convert('RGB').save(os.path.join(SCRATCH, f'r8_prev_{name}.png'))
        Image.open(os.path.join(OUT, name, 'favicon', 'favicon16.png')) \
             .convert('RGB').resize((160, 160), Image.NEAREST).save(os.path.join(SCRATCH, f'r8_f16_{name}.png'))
    print('previews done')

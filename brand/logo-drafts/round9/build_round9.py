#!/usr/bin/env python3
"""Round 9 (t_78c96450): 대문자 'AT' 타이포그래피 마크 3안 — SVG 수작업, 생성형 AI 배제.

대표님 정정(9/28): 소문자 'at'(Round8) 기각 — 대문자 AT로 자신감 있게.
타입 소스: Pretendard Variable (SIL OFL 1.1) — wght 900 정적 인스턴스의
대문자 A/T 아웃라인을 fontTools로 추출해 <path>로 베이크. 조합 설계(공용 획
좌표, tie-bar 높이·폭, 트래킹)는 좌표 계산 = 인간 저작. 2색 게이트: #00A86B + 흰색.

3안:
  opt1 AT ligature   — A 우측 대각획 하단을 T 스템에 묻어 공용 획으로 fusion
                       (DX=800: 스템 [1292,1664] 안에 A 각획 끝 1522, T 바가
                       A 우견(右肩) y1172 밴드와 이어져 한 몸이 됨)
  opt2 AT tie-bar    — A·T 제로간격(dx = 1523.74-55.47 = 1468.27) + A 가로대
                       밴드(y310~570, 260u)를 T 스템 우측변까지 연장한 연결대
  opt3 AT wordmark   — wght900 AT, 트래킹 -80 (Round8 opt3의 대문자 정통 버전)

산출: brand/logo-drafts/round9/<opt>/ 16파일×3 + comparison-sheet-round9.png + README
"""
import os, sys
sys.path.append('/usr/lib/python3/dist-packages')  # fontTools system site-packages, venv PIL wins
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import RecordingPen
from PIL import Image
import cairosvg

FONT = '/home/holysky87/worldofagents/apps/mobile/MyAgentTalk/assets/fonts/PretendardVariable.ttf'
OUT = '/home/holysky87/worldofagents/brand/logo-drafts/round9'
SCRATCH = os.path.expanduser('~/.hermes/profiles/photo/cache/scratch')
GREEN = '#00A86B'
WHITE = '#FFFFFF'

def load(weight):
    f = instantiateVariableFont(TTFont(FONT), {'wght': weight}, inplace=False)
    gs = f.getGlyphSet(); cm = f.getBestCmap()
    out = {}
    for ch in 'AT':
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

G9 = load(900)

def P(d, dx=0, dy=0, fill=GREEN):
    """path in y-up design space (font units, glyph origin 0,0)."""
    return f'<path d="{d}" transform="translate({dx:.2f} {-dy:.2f})" fill="{fill}"/>'

def wrap_mark(inner, bbox, pad=60):
    x0, y0, x1, y1 = bbox
    w, h = (x1 - x0) + 2 * pad, (y1 - y0) + 2 * pad
    g = f'<g transform="translate({-x0 + pad:.2f} {y1 + pad:.2f}) scale(1 -1)">{inner}</g>'
    return g, w, h

# ---------- Option 1: AT ligature — A 우 각획 = T 세획 공용 ----------
def build_opt1():
    A, T = G9['A'], G9['T']
    # wght900 스캔라인 실측(y-up, 폰트u): A 우 각획 외변 x= 1522@y0 · 1334@y571 · 1224@y900 · 1124@y1200 · apex 1042@y1448
    #                       T 스템 x[492,864], T 바 x[54,1302]×y[1172,1448]
    DX = 622                       # 스템을 [1114,1664]로: y1200까지 각획에 파묻힘 = 공용 획 fusion
    inner = P(A['d']) + P(T['d'], dx=DX)
    bb = [A['bbox'][0], 0, DX + T['bbox'][2], 1448]
    return wrap_mark(inner, bb)

# ---------- Option 2: AT tie-bar — 제로간격 + 가로대 연장 ----------
def build_opt2():
    A, T = G9['A'], G9['T']
    DX = 1468.27                   # A 우 bbox(1523.74) - T 좌 bbox(55.47) = 간격 0
    stem_r = DX + 864              # T 스템 우변 2332 (wght900 실측)
    bar = (f'M 1330 310 L {stem_r:.0f} 310 L {stem_r:.0f} 571 L 1330 571 Z')
    # A 가로대 우단(내측 실측 ~1330)에서 시작, 스템을 관통해 우측변에서 종료
    inner = P(A['d']) + P(T['d'], dx=DX) + P(bar)
    bb = [A['bbox'][0], 0, stem_r, 1448]
    return wrap_mark(inner, bb)

# ---------- Option 3: AT 볼드 워드마크 ----------
def build_opt3():
    A, T = G9['A'], G9['T']
    KERN = -80                     # 대문자 AT 광학 트래킹: A 각획 우하 vs T 바 좌단
    inner = P(A['d']) + P(T['d'], dx=A['adv'] + KERN)
    bb = [A['bbox'][0], 0, A['adv'] + KERN + T['bbox'][2], 1448]
    return wrap_mark(inner, bb)

def svg_doc(gfrag, w, h, size=1024, bg=None):
    rect = f'<rect width="{size}" height="{size}" fill="{bg}"/>' if bg else ''
    S = size; pad = S * 0.14
    s = min((S - 2 * pad) / w, (S - 2 * pad) / h)
    ox, oy = (S - w * s) / 2, (S - h * s) / 2
    mark = f'<g transform="translate({ox:.2f} {oy:.2f}) scale({s:.5f})">{gfrag}</g>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}">'
            f'<!-- Round9 handcrafted · Pretendard Variable outlines (SIL OFL 1.1) · no generative AI -->'
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
                     ('opt2_at_tie_bar', build_opt2),
                     ('opt3_at_wordmark', build_opt3)):
        emit_option(name, fn)
    for name in ('opt1_at_ligature', 'opt2_at_tie_bar', 'opt3_at_wordmark'):
        Image.open(os.path.join(OUT, name, 'appicon', 'appicon-white-1024.png')) \
             .convert('RGB').save(os.path.join(SCRATCH, f'r9_prev_{name}.png'))
        Image.open(os.path.join(OUT, name, 'favicon', 'favicon16.png')) \
             .convert('RGB').resize((160, 160), Image.NEAREST).save(os.path.join(SCRATCH, f'r9_f16_{name}.png'))
    print('previews done')

#!/usr/bin/env python3
"""Round 10 (t_f513cb03): 'AT' 이중판독 상징 마크 4안 — SVG 수작업, 생성형 AI 배제.

대표님 피드백(9/28): "뭔가 상징적으로 해줄 수 없나, 이거지. 글자를" — Round9
볼드 텍스트 3안은 상징성 0. 핵심 인사이트: @ 기호의 이름이 곧 'at'이고 우리
제품은 '에이전트에게 말 건다(@mention)' → AT가 동시에 @/말풍선으로 읽히는 이중 판독.

타입 소스: Pretendard Variable (SIL OFL 1.1) wght900 대문자 A·T(+@) 아웃라인
fontTools 인스턴스 → SVGPathPen 베이크. 상징 기하(원환/캐브 꼬리/even-odd 천공/
화살표)는 전부 좌표 계산 수작업. 2색 게이트 #00A86B+흰색, 일러스트 금지.

실측(y-up, 캡 1448):
  A adv1569: 외곽 (45,0)(526,1448)(1043,1448)(1524,0)(1113,0)(790,1059)(778,1059)(456,0)
             세모구멍 꼭지 y1059·밑변 y571.7, 가로대 rect x[384,1179]×y[285.4,571.7](CW union)
  T adv1360: 바 x[55.5,1304.1]×y[1140.8,1448], 스템 x[492.6,867.1]
  @ adv1783: bbox [88.9,-208,1694.2,1430] (opt3 천공 실루엣 소스)

4안:
  opt1 AT→@ 원형화  : A를 @ 안쪽 a로(0.57스케일), T 바→307u 원환(296°), T 스템→우측
                      세로획+꼬리발. 실루엣 @ + 글자 AT 동시.
  opt2 말풍선 카운터: A 세모 구멍 밑변에서 가로대를 아래로 찢는 CCW 꼬리 삼각 캐브
                      (y571.7→285.4) — A의 구멍이 말풍선. T 정통.
  opt3 부정공간 @   : A·T heavy fusion(DX=880, 각획-스템 저반부 용접) 단일 even-odd
                      패스에 @ 글리프(0.30스케일) 천공 — 덩어리 사이 흰 @. FedEx 식.
  opt4 T=말대        : T 바를 A 우견에 접속시킨 가로 화살(우단 촉)+바 위 말풍선 꼬리,
                      스템 유지 — 'A가 T에게 말을 거는' 주어+화살표 구조.
"""
import os, re, sys, math
sys.path.append('/usr/lib/python3/dist-packages')
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from PIL import Image
import cairosvg

FONT = '/home/holysky87/worldofagents/apps/mobile/MyAgentTalk/assets/fonts/PretendardVariable.ttf'
OUT = '/home/holysky87/worldofagents/brand/logo-drafts/round10'
SCRATCH = os.path.expanduser('~/.hermes/profiles/photo/cache/scratch')
GREEN = '#00A86B'
WHITE = '#FFFFFF'

def load(weight):
    f = instantiateVariableFont(TTFont(FONT), {'wght': weight}, inplace=False)
    gs = f.getGlyphSet(); cm = f.getBestCmap()
    out = {}
    for ch in 'AT@':
        g = cm[ord(ch)]
        pen = SVGPathPen(gs); gs[g].draw(pen)
        bp = BoundsPen(gs); gs[g].draw(bp)
        out[ch] = dict(adv=gs[g].width, bbox=[float(v) for v in bp.bounds], d=pen.getCommands())
    return out

GL = load(900)
A, T, ATG = GL['A'], GL['T'], GL['@']

def xform(d, s=1.0, tx=0.0, ty=0.0):
    """bake uniform scale+translate into an absolute M/L/C/Q/Z path string."""
    toks = re.findall(r'[MLCQZ]|-?\d*\.?\d+(?:[eE][-+]?\d+)?', d)
    out, i = [], 0
    while i < len(toks):
        t = toks[i]
        if t in ('M', 'L', 'C', 'Q'):
            out.append(t); i += 1
            nums = []
            while i < len(toks) and toks[i] not in ('M', 'L', 'C', 'Q', 'Z'):
                nums.append(float(toks[i])); i += 1
            for j in range(0, len(nums) - 1, 2):
                out.append(f'{nums[j]*s+tx:.2f} {nums[j+1]*s+ty:.2f} ')
        elif t == 'Z':
            out.append('Z'); i += 1
        else:
            i += 1
    return ''.join(out)

def P(d, dx=0, dy=0, fill=GREEN, scale=None, cx=None, cy=None, rule=None):
    tr = ''
    if scale is not None:
        # 스케일 중심은 y-up 폰트공간 기준: translate(cx,cy) scale translate(-cx,-cy)
        # (외부 그룹의 scale(1,-1)이 전체를 반전시키므로 y 부호를 미리 뒤집으면 안 됨)
        tr = f'translate({cx:.2f} {cy:.2f}) scale({scale:.4f}) translate({-cx:.2f} {-cy:.2f}) '
    fr = f' fill-rule="{rule}"' if rule else ''
    return f'<path d="{d}"{fr} transform="{tr}translate({dx:.2f} {-dy:.2f})" fill="{fill}"/>'

def wrap_mark(inner, bbox, pad=60):
    x0, y0, x1, y1 = bbox
    w, h = (x1 - x0) + 2 * pad, (y1 - y0) + 2 * pad
    g = f'<g transform="translate({-x0 + pad:.2f} {y1 + pad:.2f}) scale(1 -1)">{inner}</g>'
    return g, w, h

def annulus(cx, cy, r1, r2, a0, a1):
    """y-up annular sector; under the group's scale(1,-1) flip, y-up CCW renders
    as SVG sweep=1 on the outer edge (correct even without winding care)."""
    p = lambda r, a: (cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a)))
    large = 1 if (a1 - a0) % 360 > 180 else 0
    o0, o1, i1, i0 = p(r1, a0), p(r1, a1), p(r2, a1), p(r2, a0)
    return (f'M {o0[0]:.2f} {o0[1]:.2f} A {r1} {r1} 0 {large} 1 {o1[0]:.2f} {o1[1]:.2f} '
            f'L {i1[0]:.2f} {i1[1]:.2f} A {r2} {r2} 0 {large} 0 {i0[0]:.2f} {i0[1]:.2f} Z')

# ---------- Option 1: AT→@ 원형화 ----------
def build_opt1():
    CX, CY = 784.55, 724.0        # A bbox 중심 = 환 중심
    R1, R2 = 927.0, 620.0         # 환 밴드 307u = T 바 두께 그대로 원으로
    GAP = 48.0                    # 우측 96° 열림 (@ 갭)
    ring = annulus(CX, CY, R1, R2, GAP, 360 - GAP)
    # T 스템의 재해석: 갭을 메우는 우측 세로획 — 외경 폭, 환 끝면~끝면 용접
    gcos, gsin = math.cos(math.radians(GAP)), math.sin(math.radians(GAP))
    bx0, bx1 = CX + R2 * gcos, CX + R1 * gcos          # 1199.4, 1405.2
    by0, by1 = CY - R1 * gsin, CY + R1 * gsin          # 278.2, 1169.8
    stem = f'M {bx0:.2f} {by0:.2f} L {bx1:.2f} {by0:.2f} L {bx1:.2f} {by1:.2f} L {bx0:.2f} {by1:.2f} Z'
    # @ 꼬리발: 세로획 아래에서 우로 330u 킥 (하단 끝면과 동_LEVEL)
    tail = f'M {bx0:.2f} {by0:.2f} L {bx1 + 330:.2f} {by0:.2f} L {bx1 + 330:.2f} {by0 + 240:.2f} L {bx0:.2f} {by0 + 240:.2f} Z'
    # A 수납: S=0.685 → 반폭 506, 꼭지 y'=1220(내부천장 1344 아래), 발 y'=228·코너거리 708
    # = 하단 환 밴드(620~927)에 살짝 파묻혀 'a'가 링에 붙은 @ 실루엣. 외경(927)은 안 뚫음.
    S = 0.685
    inner = P(ring) + P(stem) + P(tail) + P(A['d'], scale=S, cx=CX, cy=CY)
    bb = [CX - R1, CY - R1, bx1 + 330, CY + R1]
    return wrap_mark(inner, bb)

# ---------- Option 2: 말풍선 카운터 ----------
def build_opt2():
    DX = 1489                     # round9 opt3 트래킹(-80) 계승
    # 실측 정정: A는 외곽(세모구멍 포함 concave V) + 가로대 rect 병합(CW union) 구조.
    # → 구멍 밑변(y571.7)에서 가로대만 찌르는 CCW 삼각(비침투, apex y335>285.4)은
    #   rect winding과 상쇄되어 정확히 캐브됨(nonzero/even-odd 모두 홀).
    tail = 'M 600 571.7L 560 285.4L 820 571.7Z'   # CCW 캐브: 밑변 220 폭, 좌하 사선 apex
    inner = P(A['d'] + ' ' + tail) + P(T['d'], dx=DX)
    bb = [A['bbox'][0], 0, DX + T['bbox'][2], 1448]
    return wrap_mark(inner, bb)

# ---------- Option 3: 부정공간 @ (바 한정이 even-odd 천공) ----------
def build_opt3():
    DX = 880                      # A 우각획 저반부가 T 스템[x1372.6..]에 용접 fusion
    # even-odd는 A·T 겹침까지 상쇄하므로 천공은 바 단품(rect+@)에만 적용:
    # 바(1) → @환(0 흰) → 환-카운터(1 초록) → a구멍(0 흰) = 진짜 투명 @ 천공.
    bx0, bx1 = 55.5 + DX, 1304.1 + DX
    bar = f'M {bx0:.1f} 1140.8L {bx1:.1f} 1140.8L {bx1:.1f} 1448L {bx0:.1f} 1448Z'
    s = 0.16                      # @ 1638u → 262u, 바(y1140.8~1448) 중심 x1300에 수납
    tx = 1300.0 - ((ATG['bbox'][0] + ATG['bbox'][2]) / 2) * s
    ty = 1294.3 - ((ATG['bbox'][1] + ATG['bbox'][3]) / 2) * s
    punched = P(bar + ' ' + xform(ATG['d'], s, tx, ty), rule='evenodd')
    # 각획 외변 실측: (1042.8,1448)-(1523.7,0) 직선 → y1140.8에서 x=1144.8,
    # 스템 좌변 1372.6과 만나는 건 y=454.7(각획선 상 정확). 흰 쐐기 삼각을 메우되
    # 좌변을 각획 안쪽(1104.8)으로 40u 겹쳐 AA 이음새가 각획 안에 숨게 함.
    weld = 'M 1104.8 1140.8L 1372.6 1140.8L 1372.6 454.7Z'
    # T는 스템만 먼저 깔고 천공 바를 그 위에 (바를 두 번 그리면 구멍이 초록으로 메워짐)
    stem = f'M {492.6 + DX:.1f} 0L {867.1 + DX:.1f} 0L {867.1 + DX:.1f} 1140.8L {492.6 + DX:.1f} 1140.8Z'
    inner = P(A['d']) + P(stem) + P(weld) + punched
    bb = [A['bbox'][0], 0, bx1, 1448]
    return wrap_mark(inner, bb)

# ---------- Option 4: T=말대 ----------
def build_opt4():
    DX = 1489
    bx0 = 1000.0                          # A 우견과 확실 용접 (y1448에서 A 우변 1043 침범)
    bx1 = DX + T['bbox'][2]               # 2793.1
    by0, by1 = 1140.8, 1448.0
    hy = (by0 + by1) / 2
    bar = f'M {bx0:.0f} {by0:.0f} L {bx1 - 140:.0f} {by0:.0f} L {bx1 - 140:.0f} {by1:.0f} L {bx0:.0f} {by1:.0f} Z'
    arrow = f'M {bx1 - 160:.0f} {by0 - 100:.0f} L {bx1 + 260:.0f} {hy:.0f} L {bx1 - 160:.0f} {by1 + 100:.0f} Z'
    # 말풍선 꼬리: 바 상단에서 우상향 킥 (base 2050~2250, tip 2420,1678) — 화살이 말하는 중
    tail = 'M 2050 1448L 2250 1448L 2420 1678Z'
    stem = f'M {DX + 492.6:.0f} {by0:.0f} L {DX + 867.1:.0f} {by0:.0f} L {DX + 867.1:.0f} 0 L {DX + 492.6:.0f} 0 Z'
    inner = P(A['d']) + P(bar) + P(arrow) + P(tail) + P(stem)
    bb = [A['bbox'][0], 0, bx1 + 260, 1678]
    return wrap_mark(inner, bb)

def svg_doc(gfrag, w, h, size=1024, bg=None):
    rect = f'<rect width="{size}" height="{size}" fill="{bg}"/>' if bg else ''
    S = size; pad = S * 0.14
    s = min((S - 2 * pad) / w, (S - 2 * pad) / h)
    ox, oy = (S - w * s) / 2, (S - h * s) / 2
    mark = f'<g transform="translate({ox:.2f} {oy:.2f}) scale({s:.5f})">{gfrag}</g>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}">'
            '<!-- Round10 handcrafted · Pretendard Variable outlines (SIL OFL 1.1) · no generative AI -->'
            f'{rect}{mark}</svg>')

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

def emit_option(name, maker):
    g, w, h = maker()
    d = os.path.join(OUT, name)
    os.makedirs(os.path.join(d, 'favicon'), exist_ok=True)
    os.makedirs(os.path.join(d, 'appicon'), exist_ok=True)
    master = svg_doc(g, w, h)
    master_inv = master.replace(GREEN, WHITE)
    white_tile = svg_doc(g, w, h, bg=WHITE)
    green_tile = svg_doc(g.replace(GREEN, WHITE), w, h, bg=GREEN)
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

OPTS = {'opt1_at_roundat': build_opt1, 'opt2_speech_counter': build_opt2,
        'opt3_negative_at': build_opt3, 'opt4_t_speech_arrow': build_opt4}

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    names = sys.argv[1:] or list(OPTS)
    for name in names:
        emit_option(name, OPTS[name])
    for name in names:
        Image.open(os.path.join(OUT, name, 'appicon', 'appicon-white-1024.png')) \
             .convert('RGB').save(os.path.join(SCRATCH, f'r10_prev_{name}.png'))
        Image.open(os.path.join(OUT, name, 'favicon', 'favicon16.png')) \
             .convert('RGB').resize((160, 160), Image.NEAREST).save(os.path.join(SCRATCH, f'r10_f16_{name}.png'))
    print('previews done')

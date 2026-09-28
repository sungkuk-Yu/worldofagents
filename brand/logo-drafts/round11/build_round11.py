#!/usr/bin/env python3
"""Round 11 (t_5938f561): 인간↔에이전트 소통 상징 마크 — SVG 수작업, 생성형 AI 0회.

대표님 지시(9/28 원문): "서로 말풍선 두개가 겹쳐 있고, 그 안에는 하나는 에이전트의 A,
하나는 사람을 나타내는 I — 이렇게 해보던가" → 主안 = A·I 겹말풍선, 표기 순서 2변주
(opt1a 좌I·우A=IA / opt1b 미러=AI). 3안 메아리·4안 도트연결은 폐기, 2안 물음표→대화살
만 보조 1개로 유지.

규칙: Pretendard Variable(SIL OFL 1.1) wght900 A 아웃라인 fontTools 베이크 + I빔/말풍선
아크/꼬리 전부 좌표 수작업. 2색 #00A86B+흰 — 겹침 렌즈는 에이전트 초록판이 사람 흰판
위를 덮는 음양식 교감, 경계는 흰 헤일로 재단(제3색 없음). 일러스트·인체 금지.

실측(y-up, 캡 1448):
  A adv1569: 외곽 (45.4,0)(526.4,1448)(1042.8,1448)(1523.7,0)(1113,0)(790.5,1059.3)
             (778.5,1059.3)(456.1,0), 가로대 rect x[384.3,1179.2]×y[285.4,571.7]
             내선 IL(y)=456.1+0.30435y, IR(y)=1113-0.30453y
  I wght900: adv575 스템 x[97.7,477.7]뿐(세리프 없음) → 스펙대로 상하 바rect 수작업 I빔

主안 기하 (폰트u):
  사람 = 원판 말풍선 중심(560,840) 외경560(흰판)·링 300u(16px≈2px 게이트 정격)·내창 r260
         안: 초록 I빔(스템 210 + 상하 바 290×130), 꼬리 좌하 바깥(사람이 먼저 말함)
  에이전트 = 모난 rect 말풍선 x[860,1700]×y[300,1380] r90 초록 단색 — 사람 판면 우측을
         260u 덮어 포개짐(렌즈 = 초록×흰), 경계 흰 헤일 70u, 안: 흰 A(0.45스케일 사다리꼴
         +초록 카운터 복원), 꼬리 좌하로 사람 방향(회신)
  변주 AI: 전체 x-미러(대칭축 x=870) — A·I 둘 다 좌우대칭 글자라 미러 안전.

16px 전략: 링 300u·스템 210u·A다리 185u — 흰지판 실축소 10배 육안 QC, I 소실 시
'A 단독 인식'으로 퇴색되므로 변주별 실측 행 표기 후 대표님 최종 판단.
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
OUT = '/home/holysky87/worldofagents/brand/logo-drafts/round11'
SCRATCH = os.path.expanduser('~/.hermes/profiles/photo/cache/scratch')
GREEN = '#00A86B'
WHITE = '#FFFFFF'

f900 = instantiateVariableFont(TTFont(FONT), {'wght': 900}, inplace=False)
gs = f900.getGlyphSet(); cmap = f900.getBestCmap()
pen = SVGPathPen(gs); gs[cmap[ord('A')]].draw(pen)
Ad = pen.getCommands()

def P(d, dx=0, dy=0, fill=GREEN, rule=None):
    fr = f' fill-rule="{rule}"' if rule else ''
    return f'<path d="{d}"{fr} transform="translate({dx:.2f} {-dy:.2f})" fill="{fill}"/>'

def wrap_mark(inner, bbox, pad=60):
    x0, y0, x1, y1 = bbox
    w, h = (x1 - x0) + 2 * pad, (y1 - y0) + 2 * pad
    g = f'<g transform="translate({-x0 + pad:.2f} {y1 + pad:.2f}) scale(1 -1)">{inner}</g>'
    return g, w, h

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

# ---------- 主안: A·I 겹말풍선 (공용 조판기, mirror로 표기 순서 변주) ----------
CX_H, CY_H, R_OUT, R_IN = 540.0, 840.0, 560.0, 260.0     # 사람 원판 (링 300u)
AG = (980, 300, 1880, 1380)                               # 에이전트 초록판 (포개짐 120u — 16px 분리감 확보)
BORD = 100.0                                              # 에이전트 흰 테두리 (음양 대비)

def main_inner():
    parts = []
    # 층서: 에이전트판(뒤) → 사람판(앞, 완전 링) — Mastercard식 오클루전, 실루엣 둘 다 온전
    # 1) 에이전트 모난 말풍선(기계=격자): 흰 테두리판 + 초록 단색판
    parts.append(P(rrect(AG[0] - BORD, AG[1] - BORD, AG[2] + BORD, AG[3] + BORD, 160), fill=WHITE))
    parts.append(P(rrect(*AG, 90)))
    # 에이전트 꼬리: 우하 바깥(에이전트가 말함) — 판면 하단변에 직접 용접(헤일 없음:
    # 흰 헤일이 판면 바닥을 가로질러 균열로 읽힘)
    parts.append(P(poly((1660, 330), (1820, 300), (2000, 60))))
    # 2) 사람 원형 말풍선(약속의 둥근 말): 흰 판면(에이전트판 덮음) + 초록 링 300u
    parts.append(P(circle(CX_H, CY_H, R_OUT), fill=WHITE))
    parts.append(P(circle(CX_H, CY_H, R_OUT) + ' ' + circle(CX_H, CY_H, R_IN), rule='evenodd'))
    # 사람 꼬리: 좌하 바깥 — 링과 동색 용접
    parts.append(P(poly((200, 480), (350, 340), (60, 200))))
    # 3) 초록 I빔(사람=나): 스템 180폭 + 상하 바 — 코너 (690,1020): d=√(130²+180²)=222 < 260(창)
    parts.append(P(rect(470, 660, 650, 1020)))
    parts.append(P(rect(430, 660, 690, 780)))
    parts.append(P(rect(430, 900, 690, 1020)))
    # 4) 흰 A(0.42): 가시영역 x[1100,1880] 중심 1510 — 사다리꼴+초록 카운터 복원
    s = 0.42
    tx = 1510 - 784.55 * s
    ty = 840 - 724.0 * s
    T2 = f'translate({tx:.2f} {ty:.2f}) scale({s} {s})'
    trap = poly((45.4, 0), (526.4, 1448), (1042.8, 1448), (1523.7, 0))
    hole = poly((630.1, 571.7), (938.8, 571.7), (784.5, 1059.3))
    gapq = poly((456.1, 0), (1113.0, 0), (1026.0, 285.4), (542.9, 285.4))
    parts.append(f'<path d="{trap}" transform="{T2}" fill="{WHITE}"/>')
    parts.append(f'<path d="{hole}" transform="{T2}" fill="{GREEN}"/>')
    parts.append(f'<path d="{gapq}" transform="{T2}" fill="{GREEN}"/>')
    return ''.join(parts)

def build_opt1a():
    return wrap_mark(main_inner(), (30, 40, 2060, 1450))

def build_opt1b():
    # 미러축 = 콘텐츠 중심 x=(60+2000)/2=1030 → translate(2060) scale(-1 1)
    inner = f'<g transform="translate(2060 0) scale(-1 1)">{main_inner()}</g>'
    return wrap_mark(inner, (30, 40, 2060, 1450))

# ---------- 보조안: 물음표→대화살 (원-스트로크 ? 가 회신 화살로) ----------
def build_opt2():
    DX = 1450                     # ?+화살 군과 A 간격 — 3분리 독해 방지용 타이트 트래킹
    hook = ('M 260 1150 C 250 1345 470 1445 690 1400 C 950 1350 1090 1180 1010 1000 '
            'C 950 870 800 815 700 780 C 600 745 500 695 452 616')
    stroke = (f'<path d="{hook}" fill="none" stroke="{GREEN}" stroke-width="250" '
              f'stroke-linecap="round" stroke-linejoin="round"/>')
    ang = math.atan2(616 - 780, 452 - 700)          # 축 진행방향(좌하)
    ax_, ay_ = 452 + 240 * math.cos(ang), 616 + 240 * math.sin(ang)
    bx, by = 452 + 20 * math.cos(ang), 616 + 20 * math.sin(ang)
    px, py = 200 * math.cos(ang + math.pi / 2), 200 * math.sin(ang + math.pi / 2)
    arrow = poly((ax_, ay_), (bx + px, by + py), (bx - px, by - py))
    dot = circle(690, 230, 185)                      # 사람 도트(? 점)
    TD = DX + 1569 + 240                             # T 원점: A adv + 자간
    barT = rect(55.5, 1140.8, 1304.1, 1448)
    stemT = rect(492.6, 0, 867.1, 1140.8)
    inner = stroke + P(arrow) + P(dot) + P(Ad, dx=DX) + P(barT + ' ' + stemT, dx=TD)
    bb = [135, 45, TD + 1310, 1530]
    return wrap_mark(inner, bb)

def svg_doc(gfrag, w, h, size=1024, bg=None):
    bgrect = f'<rect width="{size}" height="{size}" fill="{bg}"/>' if bg else ''
    S = size; pad = S * 0.14
    s = min((S - 2 * pad) / w, (S - 2 * pad) / h)
    ox, oy = (S - w * s) / 2, (S - h * s) / 2
    mark = f'<g transform="translate({ox:.2f} {oy:.2f}) scale({s:.5f})">{gfrag}</g>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}">'
            '<!-- Round11 handcrafted · Pretendard Variable outlines (SIL OFL 1.1) · no generative AI -->'
            f'{bgrect}{mark}</svg>')

def invert_colors(s):
    """2색 마크 전체 반전 (음양 배색 유지): 전 경로 GREEN↔WHITE."""
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

def emit_option(name, maker):
    g, w, h = maker()
    d = os.path.join(OUT, name)
    os.makedirs(os.path.join(d, 'favicon'), exist_ok=True)
    os.makedirs(os.path.join(d, 'appicon'), exist_ok=True)
    master = svg_doc(g, w, h)
    master_inv = invert_colors(master)
    white_tile = svg_doc(g, w, h, bg=WHITE)
    green_tile = svg_doc(invert_colors(g), w, h, bg=GREEN)
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

OPTS = {'opt1a_bubbles_IA': build_opt1a, 'opt1b_bubbles_AI': build_opt1b,
        'opt2_question_arrow': build_opt2}

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    names = sys.argv[1:] or list(OPTS)
    for name in names:
        emit_option(name, OPTS[name])
    for name in names:
        Image.open(os.path.join(OUT, name, 'appicon', 'appicon-white-1024.png')) \
             .convert('RGB').save(os.path.join(SCRATCH, f'r11_prev_{name}.png'))
        Image.open(os.path.join(OUT, name, 'favicon', 'favicon16.png')) \
             .convert('RGB').resize((160, 160), Image.NEAREST).save(os.path.join(SCRATCH, f'r11_f16_{name}.png'))
    print('previews done')

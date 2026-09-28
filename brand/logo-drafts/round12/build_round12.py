#!/usr/bin/env python3
"""Round 12 (t_339585a5): 1b(AI 미러) 기반 상징 발전 3변주 — 수치 스펙 고정, SVG 수작업.

대표님 9/28: "그나마 2번째게 가장 나은거 같고, 여기서 A는 에이전트를 상징해야 하고
I는 인간을 상징해야돼. 이 두번째 거에서 좀더 발전시켜보자"

정정 코멘트(#280 좌우 뒤집힘 교정) 기준 기하 (y-down 캔버스 1024, 11-Fix 수치 그대로):
  좌측 = 모난(square) 말풍선 초록 #00A86B 채움 + 흰 'A'   ← A = 에이전트 (각질·기계)
  우측 = 둥근(round) 말풍선 흰 판 + 초록 2px 선 + 초록 'I' ← I = 인간 (둥글고 유기적)
  읽는 순서 A→I = "AI". 원 r=330 중심(652,512) / 모난 560x560 rx96 중심(372,512)
  → 중심선 y=512 일치, 중심간격 280, 실 겹침폭 330, vesica 렌즈 = 모난∩원 초록 유지.
  (11-Fix 1b는 1a의 x-미러로 생성 — 본 라운드에서는 1b 네이티브 좌표로 재작성,
   꼬리 개별 변주 가능하게 레이어 분해. 대칭 글자라 미러와 픽셀 동일.)

4안:
  v0 base1b  — 골격 기준선 (꼬리 상호향: square꼬리 좌하(324,900) / round꼬리 우하(424,900))
  v1 cross   — 꼬리 교차: square꼬리 우하(480,912)로 인간 쪽, round꼬리 좌하(350,912)로
               에이전트 쪽 → 두 꼬리가 판 아래 y~875에서 X 교차(흰 round꼬리가 초록
               square꼬리를 덮어 전경/후경 분리) = '서로에게 말하기' 극대화
  v2 dot     — vesica 렌즈 안 흰 접점 1개 (560,512) r=40 = 교감의 정점 (A 우각과 판
               우변 사이 빈 초록 밴드 정중앙). 16px favicon은 무-점 판에서 배합
               ('16px에선 렌즈만 남기고 점 소멸' — 스펙 명시)
  v3 humanI  — I 상·하 바를 스타디움(rx=35)으로 둥글게 다듬은 '사람' 암시(타이포 범위
               내, 일러스트 아님). A(각질)는 원형 유지 — 형태 대비가 곧 에이전트/인간.
"""
import os, sys, math
sys.path.append('/usr/lib/python3/dist-packages')
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from PIL import Image
import cairosvg

FONT = '/home/holysky87/worldofagents/apps/mobile/MyAgentTalk/assets/fonts/PretendardVariable.ttf'
OUT = '/home/holysky87/worldofagents/brand/logo-drafts/round12'
SCRATCH = os.path.expanduser('~/.hermes/profiles/photo/cache/scratch')
GREEN = '#00A86B'
WHITE = '#FFFFFF'

f900 = instantiateVariableFont(TTFont(FONT), {'wght': 900}, inplace=False)
gs = f900.getGlyphSet(); cmap = f900.getBestCmap()

# ---- 기하 상수 (11-Fix 스펙, 1b 네이티브) ----
CX, CY, R = 652.0, 512.0, 330.0            # 둥근판 (우·인간·I)
SQ = (92.0, 232.0, 652.0, 792.0)           # 모난판 x0,y0,x1,y1 (좌·에이전트·A) 560x560
SQ_RX = 96.0
AS = 0.207                                  # A 스케일 (cap 1448 -> ~300, I빔 높이 동일)

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

def rounded(x0, y0, x1, y1, rx, ry):
    return rrect(x0, y0, x1, y1, min(rx, ry))

# A 아웃라인 (y-up 폰트u 실측, round11/11fix와 동일 좌표)
A_TRAP = poly((45.4, 0), (526.4, 1448), (1042.8, 1448), (1523.7, 0))
A_HOLE = poly((630.1, 571.7), (938.8, 571.7), (784.5, 1059.3))
A_GAPQ = poly((456.1, 0), (1113.0, 0), (1026.0, 285.4), (542.9, 285.4))

# I (1b 위치 = 1a x-미러: 스템 774..864, 바 694..924, h300, 중심 (809,512))
I_STEM = (774, 362, 864, 662)
I_BARTOP = (694, 362, 924, 432)
I_BARBOT = (694, 592, 924, 662)

# round꼬리 부착점(원판 경계 위 실측): (487,798) ~ (709,837) — 1a의 (537,798)/(315,837) 미러
# 기본 상호향: square꼬리 팁 (324,900) / round꼬리 팁 (424,900) — 팁 100px 이격, 교차 없음
TAIL_SQ_BASE = poly((184, 790), (264, 790), (324, 900))
BUBBLE_BASE = 'M 487 798 A 330 330 0 1 1 709 837 L 424 900 Z'

def mark_inner(variant):
    """층서: square꼬리(초록) → 모난판(초록) → 원판+꼬리(흰+초록2px, 단일 재봉합) →
    렌즈(모난∩원 초록) → I(초록) → A(흰) [+ 변주 요소]."""
    p = []
    if variant == 'v1_cross':
        # 꼬리 교차: square 꼬리는 우하(인간 쪽), round 꼬리는 좌하(에이전트 쪽)
        p.append(f'<path d="{poly((200, 790), (300, 790), (480, 912))}" fill="{GREEN}"/>')
        p.append(f'<path d="{rrect(*SQ, SQ_RX)}" fill="{GREEN}"/>')
        p.append(f'<path d="M 487 798 A 330 330 0 1 1 709 837 L 350 912 Z" '
                 f'fill="{WHITE}" stroke="{GREEN}" stroke-width="2"/>')
    else:
        p.append(f'<path d="{TAIL_SQ_BASE}" fill="{GREEN}"/>')
        p.append(f'<path d="{rrect(*SQ, SQ_RX)}" fill="{GREEN}"/>')
        p.append(f'<path d="{BUBBLE_BASE}" fill="{WHITE}" stroke="{GREEN}" stroke-width="2"/>')
    # vesica 렌즈 = 모난판∩원판, 초록 유지 (흰 원판 채움을 덮음)
    p.append(f'<clipPath id="circ"><path d="{circle(CX, CY, R)}"/></clipPath>')
    p.append(f'<path d="{rrect(*SQ, SQ_RX)}" fill="{GREEN}" clip-path="url(#circ)"/>')
    if variant == 'v2_dot':
        # 접점: 렌즈 좌폭 x[322(arc),652(chord)] y=512 중심선에서 A 우각(x≈475)과
        # 코드(x=652) 사이 빈 초록 밴드의 정중앙 (560,512) r=40 — A와 45px, 판 우변과
        # 52px 이격(간섭 0). 흰 점 = 초록 렌즈 위 '교감의 정점'. check_round12가
        # 픽셀로 전경/배경 완전성 검증.
        p.append(f'<circle cx="560" cy="512" r="40" fill="{WHITE}"/>')
    # I (초록) — 흰 반원판 가시영역 중심 (809,512) 정중앙, h300
    if variant == 'v3_humanI':
        p.append(f'<path d="{rounded(*I_STEM, 20, 20)}" fill="{GREEN}"/>')
        p.append(f'<path d="{rounded(*I_BARTOP, 35, 35)}" fill="{GREEN}"/>')
        p.append(f'<path d="{rounded(*I_BARBOT, 35, 35)}" fill="{GREEN}"/>')
    else:
        for r_ in (I_STEM, I_BARTOP, I_BARBOT):
            p.append(f'<path d="{rect(*r_)}" fill="{GREEN}"/>')
    # A (흰) — 모난판 정중앙 (372,512). y-flip 후 폰트u 중심(784.55,724)을 원점으로
    T = f'translate(372 512) scale({AS} {-AS}) translate(-784.55 -724)'
    p.append(f'<path d="{A_TRAP}" transform="{T}" fill="{WHITE}"/>')
    p.append(f'<path d="{A_HOLE}" transform="{T}" fill="{GREEN}"/>')
    p.append(f'<path d="{A_GAPQ}" transform="{T}" fill="{GREEN}"/>')
    return ''.join(p)

def svg_doc(inner, size=1024, bg=None):
    bgrect = f'<rect width="{size}" height="{size}" fill="{bg}"/>' if bg else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">'
            '<!-- Round12 t_339585a5 handcrafted · Pretendard A outline (SIL OFL 1.1) · 1b native geometry -->'
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

VARIANTS = [
    ('v0_base1b_AI', 'v0'),
    ('v1_tails_cross', 'v1_cross'),
    ('v2_lens_dot', 'v2_dot'),
    ('v3_humanI', 'v3_humanI'),
]

def emit_option(name, variant):
    inner = mark_inner(variant)
    d = os.path.join(OUT, name)
    os.makedirs(os.path.join(d, 'favicon'), exist_ok=True)
    os.makedirs(os.path.join(d, 'appicon'), exist_ok=True)
    master = svg_doc(inner)
    master_inv = invert_colors(master)
    white_tile = svg_doc(inner, bg=WHITE)
    green_tile = svg_doc(invert_colors(inner), bg=GREEN)
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
    # favicon 시드: 32/64는 white-tile 축소, 16은 스펙상 흰판 배경의 실루엣 판독이
    # 관건이라 white-tile에서 직접 배합. v2는 16px만 무-점 판(점 소멸 명시).
    if variant == 'v2_dot':
        base16_svg = svg_doc(mark_inner('v0'), bg=WHITE)
    else:
        base16_svg = white_tile
    tmp16 = os.path.join(SCRATCH, f'r12_{name}_16src.png')
    cairosvg.svg2png(bytestring=base16_svg.encode(), write_to=tmp16)
    base = Image.open(os.path.join(d, 'appicon', 'appicon-white-1024.png'))
    for sz in (64, 32):
        base.resize((sz, sz), Image.LANCZOS).save(os.path.join(d, 'favicon', f'favicon{sz}.png'))
    Image.open(tmp16).resize((16, 16), Image.LANCZOS).save(os.path.join(d, 'favicon', 'favicon16.png'))
    for root, _, fs in os.walk(d):
        for f in fs:
            if f.endswith('.png'):
                clamp_two_color(os.path.join(root, f))
    print('emitted', name)

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for name, v in VARIANTS:
        emit_option(name, v)
    for name, _ in VARIANTS:
        Image.open(os.path.join(OUT, name, 'appicon', 'appicon-white-1024.png')) \
             .convert('RGB').save(os.path.join(SCRATCH, f'r12_prev_{name}.png'))
        Image.open(os.path.join(OUT, name, 'favicon', 'favicon16.png')) \
             .convert('RGB').resize((160, 160), Image.NEAREST).save(os.path.join(SCRATCH, f'r12_f16_{name}.png'))
    print('previews done')

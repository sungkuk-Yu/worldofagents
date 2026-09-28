#!/usr/bin/env python3
"""Round10 probe: 실측 좌표 — A counter(세모 구멍) 형상, 각획 외변 scanline, T 획 좌표."""
import sys
sys.path.append('/usr/lib/python3/dist-packages')
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import RecordingPen

FONT = '/home/holysky87/worldofagents/apps/mobile/MyAgentTalk/assets/fonts/PretendardVariable.ttf'
f = instantiateVariableFont(TTFont(FONT), {'wght': 900}, inplace=False)
gs = f.getGlyphSet(); cm = f.getBestCmap()

def contours(gname):
    rec = RecordingPen(); gs[gname].draw(rec)
    subs, cur = [], None
    for op, args in rec.value:
        if op == 'moveTo':
            if cur: subs.append(cur)
            cur = [('moveTo', args)]
        elif cur is not None:
            cur.append((op, args))
    if cur: subs.append(cur)
    return subs

def sub_bounds(sub):
    xs, ys = [], []
    for op, args in sub:
        flat = []
        for a in args:
            if isinstance(a, (tuple, list)):
                flat.extend(a)
            else:
                flat.append(a)
        for i in range(0, len(flat) - 1, 2):
            xs.append(flat[i]); ys.append(flat[i+1])
    return min(xs), min(ys), max(xs), max(ys)

def edge_x(sub, ytarget):
    """scanline y: 서브패스 외변/내변 x 목록 (선형보간 근사)."""
    pts = []
    for op, args in sub:
        if op in ('lineTo', 'curveTo', 'qCurveTo'):
            flat = list(args)
            if op == 'lineTo':
                seg = [(args[0], args[1])]
            # 근사: 끝점만. curve는 후처리
            pts.append(seg)
    return None

for ch in 'AT':
    g = cm[ord(ch)]
    bp = BoundsPen(gs); gs[g].draw(bp)
    print(ch, 'adv', gs[g].width, 'bbox', bp.bounds)
    subs = contours(g)
    for i, s in enumerate(subs):
        print('  sub', i, 'bounds', tuple(round(v,1) for v in sub_bounds(s)), 'ops', [op for op,_ in s][:14])

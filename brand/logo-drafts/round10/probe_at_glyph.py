#!/usr/bin/env python3
"""Probe @ glyph at wght900: bbox, adv, contour winding."""
import sys
sys.path.append('/usr/lib/python3/dist-packages')
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import RecordingPen
FONT = '/home/holysky87/worldofagents/apps/mobile/MyAgentTalk/assets/fonts/PretendardVariable.ttf'
f = instantiateVariableFont(TTFont(FONT), {'wght': 900}, inplace=False)
gs = f.getGlyphSet(); cm = f.getBestCmap()
g = cm[ord('@')]
bp = BoundsPen(gs); gs[g].draw(bp)
print('@ adv', gs[g].width, 'bbox', [round(v,1) for v in bp.bounds])
rec = RecordingPen(); gs[g].draw(rec)
subs, cur = [], None
for op, args in rec.value:
    if op == 'moveTo':
        if cur: subs.append(cur)
        cur = [(op, args)]
    elif cur is not None:
        cur.append((op, args))
if cur: subs.append(cur)
for i, s in enumerate(subs):
    pts = []
    for op, args in s:
        for a in args:
            if isinstance(a, (tuple, list)):
                pts.append(tuple(a))
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    area = sum(xs[j]*ys[j+1]-xs[j+1]*ys[j] for j in range(len(xs)-1)) + (xs[-1]*ys[0]-xs[0]*ys[-1])
    print('sub', i, 'npts', len(pts), 'area', round(area), 'dir', 'CCW(+)' if area > 0 else 'CW(-)')

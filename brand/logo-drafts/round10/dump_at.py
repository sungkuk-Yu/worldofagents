#!/usr/bin/env python3
"""Full contour dump for A/T at wght900."""
import sys
sys.path.append('/usr/lib/python3/dist-packages')
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.recordingPen import RecordingPen
FONT = '/home/holysky87/worldofagents/apps/mobile/MyAgentTalk/assets/fonts/PretendardVariable.ttf'
f = instantiateVariableFont(TTFont(FONT), {'wght': 900}, inplace=False)
gs = f.getGlyphSet(); cm = f.getBestCmap()
for ch in 'AT':
    rec = RecordingPen(); gs[cm[ord(ch)]].draw(rec)
    print('==', ch, 'adv', gs[cm[ord(ch)]].width)
    for op, args in rec.value:
        pts = [tuple(round(v, 1) for v in a) if isinstance(a, (tuple, list)) else round(a, 1) for a in args]
        print(' ', op, pts)

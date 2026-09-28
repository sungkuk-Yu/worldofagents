#!/usr/bin/env python3
"""Round11 프로브: ? / A / T wght900 실측 — opt2 원-스트로크 소스 판단."""
import sys
sys.path.append('/usr/lib/python3/dist-packages')
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.recordingPen import RecordingPen

FONT = '/home/holysky87/worldofagents/apps/mobile/MyAgentTalk/assets/fonts/PretendardVariable.ttf'
f = instantiateVariableFont(TTFont(FONT), {'wght': 900}, inplace=False)
gs = f.getGlyphSet(); cm = f.getBestCmap()

for ch in 'IA':
    g = cm[ord(ch)]
    rp = RecordingPen(); gs[g].draw(rp)
    print(ch, 'adv', gs[g].width, 'ops', len(rp.value))
    for op, args in rp.value:
        flat = []
        for a in args:
            if isinstance(a, tuple):
                flat += [round(v, 1) for v in a]
            else:
                flat.append(a)
        print('  ', op, flat)

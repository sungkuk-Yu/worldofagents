#!/usr/bin/env python3
"""Probe: raw A glyph at wght900 — scanline run structure (ground truth for counter/crossbar)."""
import sys
sys.path.append('/usr/lib/python3/dist-packages')
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
import cairosvg
from PIL import Image
import io

FONT = '/home/holysky87/worldofagents/apps/mobile/MyAgentTalk/assets/fonts/PretendardVariable.ttf'
f = instantiateVariableFont(TTFont(FONT), {'wght': 900}, inplace=False)
gs = f.getGlyphSet(); cm = f.getBestCmap()
pen = SVGPathPen(gs); gs[cm[ord('A')]].draw(pen)
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -100 1600 1600" width="800" height="800">'
       f'<rect width="1600" height="1600" y="-100" fill="white"/>'
       f'<g transform="scale(1 -1)"><path d="{pen.getCommands()}" fill="black" transform="translate(0 -1448)"/></g></svg>')
im = Image.open(io.BytesIO(cairosvg.svg2png(bytestring=svg.encode()))).convert('L')
W, H = im.size  # 800x800, font y = (H - py)/H*1548 - 100 ... map: viewBox y -100..1448 flipped
# pixel row py -> font y: svg y = py/H*1548 - 100; group flips: content y' = -font_y + ... simpler:
# we placed glyph with translate(0,-1448) inside scale(1,-1): point (x, fy) -> svg y = -( -fy -1448 )?? 
# just scan and report pixel rows of transitions along center column x=400 and label rows.
px = im.load()
prev = None
print('vertical transitions at x=400 (py, font_y_est):')
for py in range(H):
    v = px[400, py] > 128
    if v != prev:
        print('  py', py, 'white' if v else 'black')
        prev = v
print('horizontal runs at selected py:')
for py in (200, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750):
    runs = []
    prev = None; start = 0
    for x in range(W):
        v = px[x, py] > 128
        if v != prev:
            if prev is not None: runs.append(('W' if prev else 'B', start, x - 1))
            prev = v; start = x
    runs.append(('W' if prev else 'B', start, W - 1))
    print('  py', py, [(k, a, b) for k, a, b in runs if k == 'B'])

#!/usr/bin/env python3
"""Round 13 pass 2 — Recraft with hardened pictogram constraints (pass1 drifted to
illustration: full bodies, feathers, frames). Same 6 concepts, v2 prompts."""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_round13_rc import rc_gen, BRIEFS, log, DST

HARD2 = ("Abstract GEOMETRIC LOGO ICON, not an illustration, not a poster. Built ONLY from circles, "
         "squares, triangles and thick arcs — like the Nike swoosh or the WWF panda in simplicity. "
         "EXACTLY two flat colors: green #00A86B and white #FFFFFF. No black, no outline color, "
         "no gradients, no shading, no text, no letters, no frame, no border around the canvas. "
         "NO humans, NO bodies, NO faces, NO full figures, NO feathers, NO realistic parts. "
         "Maximum 5 shapes total. One centered mark on pure white square, thick forms readable at "
         "16 pixels. ")

V2 = {
 's1_handshake_v2': HARD2 +
   "Idea: agreement between human and machine. Two bold rounded rectangles tilted toward each other "
   "like abstract hands meeting — left one white with green border, right one solid green — and one "
   "small solid green circle floating in the gap between their tips. Nothing else.",
 's2_two_heads_v2': HARD2 +
   "Idea: conversation. Two simple round head shapes seen from the side reduced to pure geometry: "
   "left = solid green circle, right = white circle with green border containing one green square. "
   "Between them three short horizontal green bars of different lengths, like a signal. No facial "
   "features at all, no hair, no necks.",
 's3_bird_envelope_v2': HARD2 +
   "Idea: a message flying. One chevron: a single thick green V rotated sideways like a stylized "
   "bird silhouette made of exactly two straight strokes, and a small white rectangle with a green "
   "triangle flap (envelope) placed at its open end. No wings, no feathers, no eye, no beak detail.",
 's4_wave_fountain_v2': HARD2 +
   "Idea: signal sent and received. One solid green dot dead center; on its left three concentric "
   "green arcs opening rightward, on its right three concentric arcs of the same size drawn as white "
   "gaps inside a green half-disc — the ripple travels both directions. Perfectly symmetric, "
   "wifi-style, no frame.",
 's5_open_door_v2': HARD2 +
   "Idea: the answer arrives. A solid green circle; inside it a white arch (rounded-top rectangle) "
   "with a green vertical bar offset inside the arch suggesting an ajar door, and a small green dot "
   "in the white space beside the bar. Flat, architectural, no perspective, no handle.",
 's6_knot_v2': HARD2 +
   "Idea: human and agent linked. One thick continuous stroke forming a horizontal figure-eight: the "
   "left loop is perfectly round (human), the right loop is a rounded square (agent); at the center "
   "crossing the stroke breaks with two white gaps so it appears to weave over and under. Single "
   "uniform stroke width, no texture.",
}

if __name__ == '__main__':
    picked = sys.argv[1:] or list(V2)
    failed = [n for n in picked if not rc_gen(n, V2[n], "recraftv4_vector", None,
              "https://external.api.recraft.ai/v1/images/generations/vector")]
    print('FAILED:', failed or 'none')

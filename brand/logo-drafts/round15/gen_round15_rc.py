#!/usr/bin/env python3
"""Round 15 (t_8fd7e948) — Recraft arm: '뾰족 A 문' 발전을 f1-f4.
Base: round14 RC-e1 double_door (arch + nested square opening), outer arch -> pointy A silhouette.
Policy inherited: generative only, 2 colors #00A86B+white, geometric, prompt<=1000.
A-as-shape allowed (대표님 9/28 지시); still NO wordmarks, NO other letters."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
R13 = os.path.join(os.path.dirname(HERE), 'round13')
sys.path.insert(0, R13)
import gen_round13_rc as g13

g13.DST = os.path.join(HERE, 'drafts_rc'); os.makedirs(g13.DST, exist_ok=True)
g13.LOG = os.path.join(HERE, 'rc_log.jsonl')

HARD = ("Abstract GEOMETRIC LOGO ICON, not an illustration. Built only from bold flat shapes and "
        "thick strokes. EXACTLY two flat colors: green #00A86B and white #FFFFFF. No black, no "
        "gradients, no shading, no text, no wordmark, NO letters except that the overall silhouette "
        "may form a capital letter A as a pure shape. No frame or border. NO humans, NO faces. "
        "Maximum 6 shapes. One centered mark on a pure white square canvas, thick forms readable "
        "at 16 pixels. ")

BRIEFS = {
 'f1_a_door_square': HARD +
   "Idea: the agent IS the open door. One solid green shape whose OUTLINE is a capital letter A: "
   "a pointy apex at top, two thick slanted legs reaching the bottom edge, spread like A's feet, "
   "with a small horizontal green crossbar near the bottom between the legs. The big inner counter "
   "of the A is a white opening; inside it a smaller WHITE SQUARE opening with a tiny tail at its "
   "lower-left corner like a speech bubble, also reaching the bottom edge. Nested like double open "
   "doors. Flat, architectural, no handle.",
 'f2_a_outline_open_i': HARD +
   "Idea: the door half open, the answer emerging. ONE thick green stroke forming a capital letter "
   "A silhouette with a POINTY apex (like a doorway with two slanted jambs), open at the bottom, "
   "NO crossbar. Standing inside the A opening, slightly right of center and partly overlapping the "
   "right leg: a small solid green square with a speech-bubble tail, as if stepping out through the "
   "door. Two elements only: the A outline and one small solid square. Flat.",
 'f3_a_door_bubble': HARD +
   "Idea: conversation visible through the door. One solid green capital-A silhouette: pointy apex, "
   "two thick slanted legs to the bottom, small crossbar. Its inner white counter is NOT a plain "
   "triangle: the white opening itself is shaped like a speech bubble — a rounded-corner bubble "
   "whose small tail points down into the doorway gap at the bottom. The green legs and crossbar "
   "stay sharp. Two colors, nothing else.",
 'f4_a_door_node': HARD +
   "Idea: the agent answers at a point. One solid green capital-A silhouette: pointy apex, two thick "
   "slanted legs reaching the bottom edge, a short horizontal crossbar. In the white triangular "
   "counter high in the A (just under the apex) sits ONE solid green filled circle on a white base, "
   "like a node of reply, small and unmistakable. Nothing else: A body plus one dot. Flat, bold.",
}

if __name__ == '__main__':
    picked = sys.argv[1:] or list(BRIEFS)
    failed = []
    for n in picked:
        assert len(BRIEFS[n]) <= 1000, f'{n} prompt {len(BRIEFS[n])} > 1000'
        if not g13.rc_gen(n, BRIEFS[n], "recraftv4_vector", None,
                          "https://external.api.recraft.ai/v1/images/generations/vector"):
            failed.append(n)
    print('FAILED:', failed or 'none')

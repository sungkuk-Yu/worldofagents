#!/usr/bin/env python3
"""Round 14 (t_0c3e7eaa) — Recraft arm: develop c1 knot (d1-d3) and c3 open-door (e1-e3).
Policy inherited: generative only, 2 colors #00A86B+white, geometric icon, prompt<=1000 chars.
Imports Round13 rc_gen machinery, re-targets output dir + log."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
R13 = os.path.join(os.path.dirname(HERE), 'round13')
sys.path.insert(0, R13)
import gen_round13_rc as g13

g13.DST = os.path.join(HERE, 'drafts_rc'); os.makedirs(g13.DST, exist_ok=True)
g13.LOG = os.path.join(HERE, 'rc_log.jsonl')

HARD = ("Abstract GEOMETRIC LOGO ICON, not an illustration. Built only from circles, squares and "
        "thick arcs. EXACTLY two flat colors: green #00A86B and white #FFFFFF. No black, no "
        "gradients, no shading, no text, no letters, no frame or border. NO humans, NO faces, "
        "NO realistic parts. Maximum 6 shapes. One centered mark on a pure white square canvas, "
        "thick forms readable at 16 pixels. ")

BRIEFS = {
 'd1_contrast_rings': HARD +
   "Idea: two DIFFERENT beings linked. On the left a PERFECT CIRCLE ring (human), on the right a "
   "PERFECT SQUARE ring with sharp 90-degree corners, axis-aligned, NOT rotated (agent). Both rings "
   "have the SAME thick stroke width and interlock once: the circle passes over the square at the "
   "upper crossing and under it at the lower crossing, shown by two small white gaps in the stroke. "
   "Nothing else.",
 'd2_node_crossing': HARD +
   "Idea: the moment words pass. A thick circle ring interlocked with a thick rounded-square ring "
   "like a knot with white over-under gaps at the crossings. At exactly ONE crossing point sits a "
   "SOLID green filled circle node on top of the weave, slightly larger than the stroke width, "
   "marking the contact point of the conversation. Two rings plus one solid node, nothing else.",
 'd3_knot_tail': HARD +
   "Idea: a linked message. A thick circle ring woven with a thick square ring (sharp corners): "
   "over-under crossings with white gaps, like chain links. From the lower-right corner of the "
   "square ring sticks out ONE small solid green triangle, like the tail of a speech bubble, "
   "pointing down-right. Circle, square, one tail triangle - nothing else.",
 'e1_double_door': HARD +
   "Idea: two beings in one doorway. One solid green disc. Cut out of pure white inside it: a large "
   "ARCH doorway with rounded top reaching the bottom edge (human), and INSIDE the arch a smaller "
   "SQUARE white opening with sharp corners also reaching the bottom edge (agent), offset to the "
   "right so both openings read clearly, nested like double open doors. Flat, architectural, no "
   "handle, no perspective.",
 'e2_door_speechbeam': HARD +
   "Idea: the answer comes out as words. One solid green disc with a white arched doorway ajar "
   "(a green door panel tilted inside the arch). From the gap slips out one white speech bubble "
   "shape: a rounded blob with a small tail pointing back into the doorway, and inside the bubble "
   "one small solid green dot. No handle, no frame.",
 'e3_door_knot_crossover': HARD +
   "Idea: connection happens inside the open door. One solid green disc with a white ARCH doorway "
   "cut out of it (rounded top, open at the bottom). Inside the white arch opening, drawn in green: "
   "a thick circle ring interlocked with a thick square ring, over-under weave with white gaps - a "
   "knot of two beings standing in the doorway. Nothing else.",
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

#!/usr/bin/env python3
"""Round 14 (t_0c3e7eaa) — Nano Banana arm: same 6 briefs d1-d3/e1-e3 via OpenRouter
gemini-3.1-flash-image, clean + mini variants. Imports round13 nb machinery."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
R13 = os.path.join(os.path.dirname(HERE), 'round13')
sys.path.insert(0, R13)
import gen_round13_nb as n13

n13.DR = os.path.join(HERE, 'drafts_nb'); os.makedirs(n13.DR, exist_ok=True)
n13.LOG = os.path.join(HERE, 'nb_log.jsonl')

n13.BRIEFS = {
 'd1_contrast_rings': "Two interlocked rings: left a perfect thin-free bold CIRCLE ring (human), right a bold SQUARE ring with sharp 90-degree corners, axis-aligned (agent), identical stroke thickness, weaving over-under with two white gaps at the crossings. Pure geometry, nothing else.",
 'd2_node_crossing': "A bold circle ring and a bold rounded-square ring interlocked like a knot with white over-under gaps; at one crossing a solid green filled circle node sits on top of the weave, larger than the stroke - the contact point where words pass. Two rings plus one node.",
 'd3_knot_tail': "A bold circle ring woven with a bold sharp-cornered square ring (chain-link knot, white gaps at crossings); one small solid green triangle tail sticks out from the square ring's lower-right corner like a speech bubble tail. Circle, square, one tail.",
 'e1_double_door': "One solid green disc containing two nested white openings that both reach the bottom edge: a big rounded-top ARCH doorway (human) and, offset right inside it, a smaller sharp-cornered SQUARE opening (agent), like two open doors one inside the other. Flat, no handle.",
 'e2_door_speechbeam': "One solid green disc with a white arched doorway ajar; from the gap a white speech bubble with a small tail slips outward, containing one solid green dot. The answer leaving the door as a message. No handle, no frame lines.",
 'e3_door_knot_crossover': "One solid green disc with a white arch doorway cut out of it, open at the bottom; inside the white arch, a bold green circle ring interlocked with a bold green square ring, weaving over-under with white gaps - two beings knotted together inside the doorway.",
}

if __name__ == '__main__':
    args = sys.argv[1:]
    names = args or [f"{k}_{t}" for k in n13.BRIEFS for t in n13.TAIL]
    failed = []
    for nm in names:
        key, tail = nm.rsplit('_', 1)
        if not n13.gen(nm, n13.HARD + n13.BRIEFS[key] + n13.NEG + n13.TAIL[tail]):
            failed.append(nm)
    print('FAILED:', failed or 'none')

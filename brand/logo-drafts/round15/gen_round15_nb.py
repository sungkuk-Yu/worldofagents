#!/usr/bin/env python3
"""Round 15 (t_8fd7e948) — Nano Banana arm: same f1-f4 briefs via OpenRouter
gemini-3.1-flash-image, clean + mini variants. Imports round13 nb machinery."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
R13 = os.path.join(os.path.dirname(HERE), 'round13')
sys.path.insert(0, R13)
import gen_round13_nb as n13

n13.DR = os.path.join(HERE, 'drafts_nb'); os.makedirs(n13.DR, exist_ok=True)
n13.LOG = os.path.join(HERE, 'nb_log.jsonl')

n13.BRIEFS = {
 'f1_a_door_square': "A solid green shape whose outline is a capital letter A made purely as a doorway: pointy apex, two thick slanted legs standing on the ground line, a short crossbar low between the legs. Inside the big white counter of the A, a smaller white square opening reaching the bottom, with a tiny speech-bubble tail at its lower-left. Nested double doors, flat, no handle.",
 'f2_a_outline_open_i': "One bold green outline of a capital A formed like an open doorway: pointy apex where two slanted thick jambs meet, open at the bottom, no crossbar. Inside the doorway stands a small solid green rounded square with a speech-bubble tail, slightly right and overlapping one jamb, stepping out. Two elements only, flat two-color.",
 'f3_a_door_bubble': "A solid green capital A silhouette: pointy apex, two thick slanted legs to the bottom, small crossbar. Its inner white counter is shaped like a speech bubble — rounded corners with a small tail pointing down through the doorway gap at the bottom. Green A frame around a white bubble. Two colors only.",
 'f4_a_door_node': "A solid green capital A silhouette: pointy apex, thick slanted legs reaching the bottom edge, a short crossbar. In the white triangular counter just below the apex sits one small solid green filled circle on white — a reply node glowing inside the doorway. A body plus one dot, nothing else.",
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

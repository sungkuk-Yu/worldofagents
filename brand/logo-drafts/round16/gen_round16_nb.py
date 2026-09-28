#!/usr/bin/env python3
"""Round 16 (t_80e9d22e) — Nano Banana arm: f3·f4 정밀 발전 6안.
대표님 9/28: R15 시트에 f3 버블카운터·f4 실심노드 초록 마커 + "이 두 개로 개선해".
f3 계보: g1 버블 부정공간 정밀화(꼬리 방향·비율) / g2 다리 폭 조정 16px 가독성 / g3 둥근 A 교정(봉우리 라운딩).
f4 계보: g4 노드 크기·위치 최적화(손잡이↔대화 접점 이중판독) / g5 A+노드 극한 미니(파비콘) / g6 둥근 A 교정.
Recraft 크레딧 소진 지속(9/28 R15 사고) → 전원 NB. 수작업 SVG 0회.
Imports round13 nb machinery (HARD/NEG/gen/log)."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
R13 = os.path.join(os.path.dirname(HERE), 'round13')
sys.path.insert(0, R13)
import gen_round13_nb as n13

n13.DR = os.path.join(HERE, 'drafts_nb'); os.makedirs(n13.DR, exist_ok=True)
n13.LOG = os.path.join(HERE, 'nb_log.jsonl')

BRIEFS = {
 # ---- f3 계보: 뾰족 A + 말풍선 부정공간 ----
 'g1_f3_bubble_refine':
   "A solid green capital-A silhouette: sharp pointy apex, two thick slanted legs standing on the "
   "bottom line, short crossbar low between the legs. Its inner white counter is ONE speech bubble: "
   "rounded rectangle, centered just above the crossbar, sized about 45 percent of the A height, with "
   "an even thick green frame all around it. From the bubble's bottom edge a short slim triangular "
   "tail points straight DOWN through the doorway gap between the legs. Tail direction vertical, not "
   "sideways. Two colors only, flat.",
 'g2_f3_bubble_bold16':
   "Ultra-bold favicon-first mark: one solid green capital A, sharp pointy apex, VERY thick slanted "
   "legs, thick low crossbar, so the green frame stays heavy at tiny sizes. The single white counter "
   "inside is a simple speech bubble — a fat rounded blob with one short THICK triangular tail "
   "pointing down, no thin parts anywhere. Fewest possible shapes, maximum stroke weight, readable "
   "at 16 pixels. Two flat colors only.",
 'g3_f3_bubble_roundA':
   "A solid green capital-A silhouette with a ROUNDED soft dome apex instead of a sharp point, two "
   "thick gently curved legs standing on the bottom line, short crossbar low between the legs. Its "
   "inner white counter is one rounded-corner speech bubble with a small triangular tail pointing "
   "straight down through the doorway gap. Friendly rounded geometry, flat, two colors only, thick "
   "forms readable at 16 pixels.",
 # ---- f4 계보: 뾰족 A + 초록 실심 노드 ----
 'g4_f4_node_knob':
   "A solid green capital-A silhouette: sharp pointy apex, two thick slanted legs to the bottom, "
   "short crossbar. In its white triangular counter sits ONE solid green filled circle placed LOW "
   "and to the right, touching the crossbar line like a door handle on an open door — one dot, two "
   "readings: doorknob and reply node. Dot diameter about one third of the counter width. Nothing "
   "else: A body plus one dot. Flat, two colors only.",
 'g5_f4_node_mini':
   "A solid green capital-A silhouette: pointy apex, thick slanted legs reaching the bottom edge, "
   "short crossbar. In the white triangular counter just below the apex sits one small solid green "
   "filled circle on white — a reply node glowing inside the doorway. A body plus one dot, nothing "
   "else.",
 'g6_f4_node_roundA':
   "A solid green capital-A silhouette with a ROUNDED soft dome apex instead of a sharp point, two "
   "thick gently curved legs to the bottom line, short crossbar. Centered in its white triangular "
   "counter sits ONE solid green filled circle — a reply node inside the doorway. Friendly rounded "
   "geometry, A body plus one dot only, flat, two colors, readable at 16 pixels.",
}
MINI_TAIL = (" Make it even simpler: reduce to the fewest possible shapes, maximum boldness, "
             "favicon-first design.")
TAILS = {'g5_f4_node_mini': MINI_TAIL}

if __name__ == '__main__':
    names = sys.argv[1:] or list(BRIEFS)
    failed = []
    for nm in names:
        prompt = n13.HARD + BRIEFS[nm] + n13.NEG + TAILS.get(nm, "")
        assert len(prompt) <= 1000, f'{nm} prompt {len(prompt)} > 1000'
        if not n13.gen(nm, prompt):
            failed.append(nm)
    print('FAILED:', failed or 'none')

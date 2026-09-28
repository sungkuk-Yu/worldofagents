#!/usr/bin/env python3
"""Round 17 (t_a9997448) — Nano Banana arm: 'A(문)에서 I(사람)가 빠져 → 말풍선' 확정 서사 4변주.
대표님 9/28: R15 시트 최상단 RC-e1(빨간 마커)의 '문 아래서 말풍선이 빠져나오는' 구성 유지,
문 실루엣을 A 문자 형태로, 문에서 I(사람 글리프)가 빠져나와 채팅 버블을 만드는 순간.
h1 e1 골격 직역(뾰족A문) / h2 g6 라운딩 A문 / h3 반쯤 열린 문(leaf) / h4 부정공간 16px 특화.
수작업 SVG 0회 — 생성형만. Imports round13 nb machinery (HARD/NEG/gen/log)."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
R13 = os.path.join(os.path.dirname(HERE), 'round13')
sys.path.insert(0, R13)
import gen_round13_nb as n13

n13.DR = os.path.join(HERE, 'drafts_nb'); os.makedirs(n13.DR, exist_ok=True)
n13.LOG = os.path.join(HERE, 'nb_log.jsonl')

BRIEFS = {
 # h1: e1 골격 그대로 — 뾰족 A문 + I 빠져나옴 + 말풍선 (최소 변경 직역)
 'h1_a_door_i_bubble':
   "One solid green capital-A silhouette as a doorway: sharp pointy apex, two thick slanted legs on "
   "the bottom line, one short low crossbar. From the gap below the crossbar one small solid green "
   "person glyph steps out: square head block over a slim vertical body, no face, no arms. To its "
   "right floats exactly ONE white speech bubble, rounded rectangle with a thick green frame and "
   "exactly ONE small triangular tail pointing at the figure. One bubble, one tail, one figure. Flat.",
 # h2: g6 라운딩 A문 + I + 말풍선 (둥근 A 교정판 계보)
 'h2_roundA_i_bubble':
   "A solid green capital-A silhouette with a ROUNDED soft dome apex, two thick gently curved legs on "
   "the bottom line, short low crossbar. From the doorway under the crossbar a small solid green "
   "person glyph steps half out: square head block over one slim vertical body, no face. Right beside "
   "it ONE white speech bubble with a thick green frame and a single small triangular tail aimed at "
   "the figure. One bubble, one tail, one figure only. Friendly rounded geometry, flat, two colors.",
 # h3: 반쯤 열린 문(leaf) + I + 말풍선 — '열림' 강조
 'h3_halfopen_door':
   "One solid green capital-A doorway: pointy apex, two thick slanted legs on the bottom line, short "
   "low crossbar. Its right leg is a HALF-OPEN door: a thick green rectangle tilted outward about 30 "
   "degrees, leaving a slanted opening. Through it a small solid green person glyph (square head, "
   "slim body, no face) steps out. Beside it ONE white rounded speech bubble with a thick green "
   "frame and a single tail pointing at the figure. One bubble, one tail. Flat, two colors only.",
 # h4: A문 통짜 채움 + 부정공간 I·말풍선 — 16px 최강 목표
 'h4_negative_i':
   "Ultra-bold favicon-first mark: one VERY thick solid green capital-A, pointy apex, two fat slanted "
   "legs on the bottom line, thick low crossbar. In the doorway under the crossbar stands one small "
   "chunky solid green person glyph: square head over slim body, no face. Beside its head, carved as "
   "WHITE NEGATIVE SPACE inside the green body, exactly ONE speech bubble: a rounded white void with "
   "one short white tail notch pointing at the glyph. A body, one figure, one bubble void. No thin "
   "parts. Flat, two colors.",
}
MINI_TAIL = (" Make it even simpler: reduce to the fewest possible shapes, maximum boldness, "
             "favicon-first design.")
TAILS = {'h4_negative_i': ""}  # h4 brief already favicon-first

if __name__ == '__main__':
    names = sys.argv[1:] or list(BRIEFS)
    failed = []
    for nm in names:
        prompt = n13.HARD + BRIEFS[nm] + n13.NEG + TAILS.get(nm, "")
        assert len(prompt) <= 1000, f'{nm} prompt {len(prompt)} > 1000'
        if not n13.gen(nm, prompt):
            failed.append(nm)
    print('FAILED:', failed or 'none')

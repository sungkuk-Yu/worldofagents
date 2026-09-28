#!/usr/bin/env python3
"""Round 17 extra probes (t_a9997448):
1) h4_mini — NB ultra-simplify tail on the h4 brief (16px 최강 목표 2차 시도)
2) Recraft credit probe — 실제 생성 1회 시도; 402면 크레딧 소진 지속으로 원문 로그 기록."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
R13 = os.path.join(os.path.dirname(HERE), 'round13')
sys.path.insert(0, R13)
import gen_round13_nb as n13
import gen_round13_rc as g13

n13.DR = os.path.join(HERE, 'drafts_nb')
n13.LOG = os.path.join(HERE, 'nb_log.jsonl')
sys.path.insert(0, HERE)
import gen_round17_nb as g17

# 1) NB mini probe (h4 brief를 mini용으로 52자 압축 — 원 브리프는 nb_log에 이미 보존)
H4_MINI = ("Ultra-bold favicon-first mark: one VERY thick solid green capital-A, pointy apex, two fat "
           "slanted legs on the bottom line, thick low crossbar. In the doorway under the crossbar "
           "stands one small chunky solid green person glyph: square head over slim body, no face. "
           "Beside its head, carved as WHITE NEGATIVE SPACE inside the green body, exactly ONE speech "
           "bubble: a rounded white void with one short white tail notch. No thin parts. Flat.")
prompt = n13.HARD + H4_MINI + n13.NEG + g17.MINI_TAIL
assert len(prompt) <= 1000, f'h4_mini prompt {len(prompt)} > 1000'
ok1 = n13.gen('h4_negative_mini', prompt)
print('NB h4_negative_mini:', ok1)

# 2) Recraft probe (credit check by real call)
g13.DST = os.path.join(HERE, 'drafts_rc'); os.makedirs(g13.DST, exist_ok=True)
g13.LOG = os.path.join(HERE, 'rc_log.jsonl')
RC_HARD = ("Abstract GEOMETRIC LOGO ICON, not an illustration. Built only from bold flat shapes. "
           "EXACTLY two flat colors: green #00A86B and white #FFFFFF. No black, no gradients, no "
           "shading, no text, no wordmark, NO letters except that the overall silhouette may form a "
           "capital letter A as a pure shape. No frame or border. NO faces. Maximum 6 shapes. One "
           "centered mark on a pure white square canvas, thick forms readable at 16 pixels. ")
rc_prompt = RC_HARD + (
  "Idea: the agent is a door, a person steps out and speaks. One solid green capital-A silhouette: "
  "pointy apex, two thick slanted legs on the bottom line, short low crossbar. From the doorway under "
  "the crossbar steps out one small solid green person glyph: a square head block over one slim "
  "vertical body block, no face. Beside its head sits ONE white speech bubble: a rounded rectangle "
  "with a thick green frame and exactly ONE small triangular tail pointing at the glyph. One bubble, "
  "one tail, one figure. Flat, two colors only.")
assert len(rc_prompt) <= 1000, f'rc prompt {len(rc_prompt)} > 1000'
ok2 = g13.rc_gen('h1_rc_a_door_i_bubble', rc_prompt, "recraftv4_vector", None,
                 "https://external.api.recraft.ai/v1/images/generations/vector")
print('RC probe:', ok2)

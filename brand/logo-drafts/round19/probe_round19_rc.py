#!/usr/bin/env python3
"""Round 19 credit probe (t_b3f4c45a): Recraft V4 vector 1회 실호출 상한(규정 계승).
400 not_enough_credits면 원문 로그 기록 후 NB 전용으로 라운드 완수."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
R13 = os.path.join(os.path.dirname(HERE), 'round13')
sys.path.insert(0, R13)
import gen_round13_rc as g13

g13.DST = os.path.join(HERE, 'drafts_rc'); os.makedirs(g13.DST, exist_ok=True)
g13.LOG = os.path.join(HERE, 'rc_log.jsonl')
RC_HARD = ("Abstract GEOMETRIC LOGO ICON, not an illustration. Built only from bold flat shapes. "
           "EXACTLY two flat colors: green #00A86B and white #FFFFFF. No black, no gradients, no "
           "shading, no text, no wordmark. No frame or border. Maximum 6 shapes. One centered mark "
           "on a pure white square canvas, thick forms readable at 16 pixels. ")
rc_prompt = RC_HARD + (
  "Idea: a bold round letter-A doorway mark whose HEAD IS WIDE. Solid green capital-A silhouette, "
  "broad blunt rounded apex, the top third bulges wider left-right (wide arch shoulders), legs "
  "splaying no more than before. Inside the upper body ONE white counter shaped like a straight "
  "vertical letter i: a clean upright rounded-rectangle bar, perfectly straight sides, with ONE "
  "small triangular speech-bubble tail only at its very bottom end. Below it one open white "
  "doorway void between the legs reaching the bottom edge. Flat, two colors only.")
assert len(rc_prompt) <= 1000, f'rc prompt {len(rc_prompt)} > 1000'
ok = g13.rc_gen('m1_rc_widehead', rc_prompt, "recraftv4_vector", None,
                "https://external.api.recraft.ai/v1/images/generations/vector")
print('RC probe:', ok)

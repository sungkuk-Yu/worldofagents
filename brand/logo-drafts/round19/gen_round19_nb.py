#!/usr/bin/env python3
"""Round 19 (t_b3f4c45a) — Nano Banana arm: g3 기준 'A 머리(어깨) 넓히기 + 안쪽 i 일직선화' 3변주.
대표님 9/28 원문: "아니 그냥 이게 좋다. 에이 안에 아이처럼 보이면서 그 안에 채팅 버블이 있고 너무
찬찬해. 근데 위에 에이의 머리 측면이 좀 더 넓고, 안에 있는 i가 좀 더 일직선처럼 수정됐으면 좋겠다.
에이가 양옆으로 공간을 좀 더 넓혀야 가능하지" — 기준안 = selected/AT-mark-g3_roundA(R16 g3).
m1=지시 그대로(머리 넓힘+i 일직선 세로막대+꼬리는 i 아래 끝 한 번), m2=머리 확장만큼 i도 키움,
m3=머리 넓힘+꼬리 제거 순수 i直立(대조군). 다리 외곽 벌림은 현행 이하, 가로대 비율 유지.
수작업 SVG 0회 — 생성형만. Imports round13 nb machinery (HARD/NEG/gen/log)."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
R13 = os.path.join(os.path.dirname(HERE), 'round13')
sys.path.insert(0, R13)
import gen_round13_nb as n13

n13.DR = os.path.join(HERE, 'drafts_nb'); os.makedirs(n13.DR, exist_ok=True)
n13.LOG = os.path.join(HERE, 'nb_log.jsonl')

# g3 골격 공통: 넓은 머리 + i 직립 카운터 + 아래 문. 다리 벌림은 기존 이하로 고정
G = ("Below the counter, one open white doorway void between the legs reaching the bottom edge. "
     "Flat two colors, no outline. ")

BRIEFS = {
 # m1: 지시 그대로 — 머리 측면 15-20% 넓힘(무둔 둥근 꼭지+넓은 어깨), i는 곧은 세로막대, 꼬리 아래 한 번
 'm1_widehead_straighti':
   "A very bold solid green capital-A silhouette whose HEAD IS WIDE: blunt rounded apex, top "
   "third bulging left and right with broad round shoulders; legs thick, splaying no wider than "
   "the shoulders. Inside the head ONE white counter like the letter i: an upright STRAIGHT "
   "rounded-rectangle bar with perfectly straight parallel sides, ONE small triangular "
   "speech-bubble tail only at its very bottom end. " + G +
   "The i bar is one straight line.",
 # m2: 머리 확장분만큼 i 몸통도 크게 — 넓은 머리-큰 i 비례 동조
 'm2_widehead_big_i':
   "A very bold solid green capital-A silhouette with a WIDE HEAD: blunt rounded top, upper third "
   "spreading left-right to nearly full mark width like broad shoulders; two thick legs. Filling "
   "that wide head, ONE LARGE white i-shaped counter: a tall upright rounded-rectangle bar, "
   "straight parallel sides, two thirds of the head height, ONE small triangular speech-bubble "
   "tail at its bottom end. " + G +
   "Big straight i inside a wide round head.",
 # m3: 대조군 — 머리 넓힘 + 꼬리 제거 순수 i 직립 (막대+점 없는 순수 세로 카운터)
 'm3_widehead_pure_i':
   "A very bold solid green capital-A silhouette, WIDE blunt rounded head: top third bulging left "
   "right with broad round shoulders; two thick splayed legs. Inside the head exactly ONE white "
   "vertical counter: a perfectly straight upright rounded-rectangle bar, parallel sides, NO "
   "tail, NO notch — one clean straight slit like a plumb line. " + G +
   "Wide round A outside, one straight i-line inside.",
}
TAILS = {k: "" for k in BRIEFS}

if __name__ == '__main__':
    names = sys.argv[1:] or list(BRIEFS)
    failed = []
    for nm in names:
        prompt = n13.HARD + BRIEFS[nm] + n13.NEG + TAILS.get(nm, "")
        assert len(prompt) <= 1000, f'{nm} prompt {len(prompt)} > 1000'
        print(nm, 'prompt len', len(prompt))
        if not n13.gen(nm, prompt):
            failed.append(nm)
    print('FAILED:', failed or 'none')

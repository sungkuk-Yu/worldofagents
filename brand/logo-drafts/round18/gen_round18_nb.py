#!/usr/bin/env python3
"""Round 18 (t_f580939c) — Nano Banana arm: g3 기준 '둥근데 A로 읽히는' 실루엣 교정 4변주.
대표님 9/28 원문: "오 그렇지 이거 좀 바꿔보자. 이것을 기준으로 에이를 좀 더 둥글게 바꿔보자.
모양이 에이치 비슷하게" — 방향 확정(카드 코멘트 2건): g3(R16 라운드A)보다 한 단계 더 둥글게
(꼭대기 뭉개짐 허용)되 말풍선 카운터는 유지. k0=H방향 반단계(플랫탑), k1=봉우리 유지 극단,
k2=가로대(말풍선=크로스바) 강조, k3=최소봉우리 극단. g3 골격 고정: 초록 통짜 A 실루엣 +
위쪽 흰 말풍선 카운터(꼬리 1) + 아래 뚫린 문. 수작업 SVG 0회 — 생성형만.
Imports round13 nb machinery (HARD/NEG/gen/log)."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
R13 = os.path.join(os.path.dirname(HERE), 'round13')
sys.path.insert(0, R13)
import gen_round13_nb as n13

n13.DR = os.path.join(HERE, 'drafts_nb'); os.makedirs(n13.DR, exist_ok=True)
n13.LOG = os.path.join(HERE, 'nb_log.jsonl')

# g3 고정 골격 문구 (모든 변주 공통) — 외곽 실루엣만 변주, 카운터 구성은 동일
G3 = ("Inside the upper body, ONE white speech-bubble void: wide rounded rectangle with one "
      "small triangular tail notch pointing down. Below it, one open white doorway void between "
      "the legs reaching the bottom edge. Flat, no outline. ")

BRIEFS = {
 # k0: g3→H 방향 반단계 — 꼭대기 완전 플랫, 다리는 수직에 가깝게, 좌상단/우하단 라운딩
 'k0_flat_top':
   "A VERY bold solid green blocky doorway: a thick rounded rectangle with a COMPLETELY FLAT "
   "top edge (no peak, no dome), two very thick nearly VERTICAL legs, soft rounded corners, "
   "top-left and bottom-right corners rounder. " + G3 +
   "One heavy friendly solid mass, like a bold gate.",
 # k1: 봉우리 존재·라운드 강함 — peak 작게라도 반드시 살림, 다리 각 벌어진 극단
 'k1_dome_peak':
   "A solid green capital-A silhouette with a small but CLEARLY PRESENT rounded peak at top "
   "center, two thick legs splaying wide outward to the bottom line, every corner heavily "
   "rounded like an inflated pebble, maximum fillet radius. " + G3 +
   "The tiny peak and splaying legs are the only sharp cues; everything else is round.",
 # k2: 가로대 강조형 — 말풍선이 크로스바 역할을 겸하는 이중 판독
 'k2_crossbar_bubble':
   "A very round solid green capital-A silhouette, soft dome apex, two thick curved legs on the "
   "bottom line. Its crossbar IS the speech bubble: exactly ONE wide white rounded-rectangle "
   "void stretching horizontally across the middle like a bar, with one small triangular tail "
   "notch hanging under its left end. Below the bar, one open white doorway void between the "
   "legs reaching the bottom edge. Flat two colors, no outline. The wide horizontal white bar "
   "is the strongest feature.",
 # k3: 최소봉우리 실험 — 봉우리 거의 없이, 다리 각 + 말풍선 가로대만으로 A 판독 (둥근 취향 최대)
 'k3_minimal_peak':
   "An ultra-bold almost circular solid green shape, softly rounded like an arch stone, with "
   "only the faintest gentle bump at the very top (almost flat), and two short thick legs at "
   "the bottom slanting slightly outward. " + G3 +
   "The only reading cues are the slanting legs and the wide bubble bar. Maximum roundness, "
   "maximum boldness.",
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

#!/usr/bin/env python3
"""Round 13 (t_59c343c7) — Recraft arm: 6 '人↔에이전트 소통' true-symbol briefs.
정책 전환: 생성형 필수(Python 수작업 SVG 금지). Recraft V4 SVG 출력 시도, 실패 시 v3_vector 폴백.
Each brief: two-color #00A86B+white, flat pictogram, NO letter A/I forcing (wordmark separately).
Usage: python3 gen_round13_rc.py [s1_handshake ...]  (no args = all)"""
import os, sys, json, time, urllib.request, urllib.error, io, base64
sys.path.append('/usr/lib/python3/dist-packages')
import cairosvg
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DST = os.path.join(HERE, 'drafts_rc')
os.makedirs(DST, exist_ok=True)
_ENV = os.path.expanduser('~/.hermes/profiles/photo/.env')
KEY = [l.split('=', 1)[1].strip() for l in open(_ENV) if l.startswith('RECRAFT_API_KEY')][0]
LOG = os.path.join(HERE, 'rc_log.jsonl')

HARD = ("Flat two-color pictogram logo mark, EXACTLY solid green #00A86B and pure white #FFFFFF, "
        "no gradients, no shading, no outlines in a third color, no text, no letters, no wordmark, "
        "no realistic detail. Square 1:1 canvas, generous white margin, centered mark. "
        "Extreme simplification like a world-class brand pictogram (WWF, Airbnb, OOH level): "
        "few shapes, thick confident geometry, instantly readable even at 16 pixels. ")
NEG = ("Do NOT draw fingers, knuckles, faces, hair, clothing wrinkles, tiny parts, drop shadows, "
       "photo style, isometric style, or 3D. ")

BRIEFS = {
 's1_handshake': HARD + NEG +
   "Concept: human and agent in agreement. A HUMAN HAND and A ROBOT/mechanical hand seen side profile, "
   "meeting like a handshake but NOT touching: between them floats one small perfect green circle "
   "(the message being passed). The human hand is plain white silhouette with green edge, the robot hand "
   "is solid green with segment gaps. Two hands only, cropped at the wrist, no arms, no bodies.",
 's2_two_heads': HARD + NEG +
   "Concept: human talking to an agent. Two abstract head silhouettes in profile facing each other: "
   "LEFT head is a solid green round organic profile (human), RIGHT head is a white profile edged in "
   "green with a grid pattern (machine). Between their faces three horizontal signal lines of "
   "different length pass like a voice wave. Heads are minimal blobs WITHOUT eyes, nose, mouth - "
   "pure profile geometry.",
 's3_bird_envelope': HARD + NEG +
   "Concept: a message in flight. One abstract origami-style bird made of THREE straight-edged green "
   "triangles (body + two wing angles), flying to the right, carrying a small white rectangle envelope "
   "with green flap in its beak. No feathers, no eye, no realistic bird anatomy - the bird must read as "
   "folded geometry. Below, empty white space; nothing else.",
 's4_wave_fountain': HARD + NEG +
   "Concept: a signal sent and received. One solid green filled circle at center (the contact point), "
   "and from it radiate two sets of concentric arc segments (like wifi ripple arcs) in OPPOSITE "
   "directions along the horizontal axis: arcs on the left are green solid, arcs on the right are white "
   "with green edge on a green disc backing, so the signal visibly travels both ways between two parties. "
   "Exactly 3 arcs each side, uniform gaps.",
 's5_open_door': HARD + NEG +
   "Concept: an answer coming through. One big solid green circle (a round doorway / porthole). Inside it, "
   "cut out of pure white, a simple arched door shape standing slightly ajar, and from the opening slips "
   "out one clean beam: a white triangle of light with a small green dot in it (the arriving reply). "
   "No handle, no frame lines, no steps. Geometric, architectural, quiet.",
 's6_knot': HARD + NEG +
   "Concept: two beings interlocked in one conversation. ONE continuous loop like an infinity knot drawn "
   "with a single thick stroke: the LEFT half of the loop is a soft rounded organic curve (human), the "
   "RIGHT half is a squared-off path with sharp 90-degree corners (agent); where they cross in the "
   "middle the green stroke passes OVER itself leaving a white gap on one side. Flat, single stroke "
   "weight, no rope texture, no shading.",
}

def log(rec):
    with open(LOG, 'a') as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")

def rc_gen(name, prompt, model, style, endpoint):
    body = {"prompt": prompt, "model": model,
            "size": "1024x1024", "n": 1, "response_format": "url"}
    if style: body["style"] = style
    req = urllib.request.Request(endpoint, data=json.dumps(body).encode(),
        method="POST", headers={"Authorization": f"Bearer {KEY}",
        "Content-Type": "application/json"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                d = json.load(r)
            url = d['data'][0].get('url')
            if url:
                with urllib.request.urlopen(url, timeout=120) as f:
                    raw = f.read()
                if raw[:200].lstrip().startswith((b'<svg', b'<?xml')):
                    out_svg = os.path.join(DST, name + '.svg')
                    out_png = os.path.join(DST, name + '.png')
                    open(out_svg, 'wb').write(raw)
                    png = cairosvg.svg2png(bytestring=raw, output_width=1024, output_height=1024)
                    im = Image.open(io.BytesIO(png)).convert('RGBA')
                    bg = Image.new('RGBA', im.size, (255, 255, 255, 255))
                    Image.alpha_composite(bg, im).convert('RGB').save(out_png)
                    log({"name": name, "tool": "recraft", "model": model, "style": style,
                         "prompt": prompt, "ok": True})
                    print('RC ok', name); return True
                print('RC not svg', name, raw[:80]); return False
            print('RC no-url', name, json.dumps(d)[:200])
            log({"name": name, "tool": "recraft", "model": model, "ok": False,
                 "resp": json.dumps(d)[:500]})
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:300]
            print('RC HTTP', e.code, name, msg)
            log({"name": name, "tool": "recraft", "model": model, "ok": False,
                 "err": f"{e.code} {msg}"})
            if e.code in (400, 401, 402, 422): return False
        except Exception as e:
            print('RC err', name, str(e)[:150])
        time.sleep(5 * (attempt + 1))
    return False

ENDPOINT = "https://external.api.recraft.ai/v1/images/generations/vector"
if __name__ == '__main__':
    picked = sys.argv[1:] or list(BRIEFS)
    # model/style negotiation: V4 first, fallback v3
    combos = [("recraftv4_vector", "Vector art"), ("recraftv3_vector", "Vector art")]
    failed = []
    for n in picked:
        done = False
        for m, s in combos:
            if rc_gen(n, BRIEFS[n], m, s, ENDPOINT):
                done = True; break
        if not done: failed.append(n)
    print('FAILED:', failed or 'none')

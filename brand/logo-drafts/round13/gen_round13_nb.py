#!/usr/bin/env python3
"""Round 13 (t_59c343c7) — Nano Banana arm: same 6 symbol briefs via OpenRouter
google/gemini-3.1-flash-image. 2 variants per brief: clean / ultra-minimal 16px-first.
Usage: python3 gen_round13_nb.py [s1_handshake_clean ...] (no args = all)"""
import os, sys, json, base64, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DR = os.path.join(HERE, 'drafts_nb')
os.makedirs(DR, exist_ok=True)
_ENV = os.path.expanduser('~/.hermes/profiles/photo/.env')
KEY = [l.split('=', 1)[1].strip() for l in open(_ENV) if l.startswith('OPENROUTER_API_KEY')][0]
LOG = os.path.join(HERE, 'nb_log.jsonl')

HARD = ("STRICT: EXACTLY two flat colors — solid green #00A86B and pure white #FFFFFF. "
        "No gradients, no shading, no third color, no texture, NO text, NO letters. "
        "Flat vector brand pictogram, square 1:1 white canvas, generous margin, centered. "
        "Extreme simplicity: very few shapes, thick strokes, must stay readable at 16 pixels. ")
NEG = ("No realistic hands or faces, no fingers detail, no eyes, no 3D, no drop shadow, no outline strokes thinner than 5% of canvas. ")

BRIEFS = {
 's1_handshake': "A simple human hand silhouette and a blocky robot hand in profile meeting like a handshake but not touching; one small solid green circle floats between them like a passed message. Human hand white with green edge, robot hand solid green.",
 's2_two_heads': "Two abstract head silhouettes in profile facing each other: left head solid green organic round human profile, right head white machine profile with a coarse 2x2 green grid inside; three horizontal signal dashes of varying length pass between their faces.",
 's3_bird_envelope': "One abstract bird folded from exactly three straight-edged green triangles, flying right, carrying a small white envelope with green flap in its beak. Pure geometry, no feathers, no eye.",
 's4_wave_fountain': "A solid green center disc radiating two opposite sets of three concentric signal arcs along the horizontal axis — left arcs solid green on white, right arcs white on a green half-disc — one signal travelling both ways.",
 's5_open_door': "One large solid green circle containing a white arched doorway drawn slightly ajar; a clean white triangle of light slips out of the gap with one small green dot inside it. No handle, no frame.",
 's6_knot': "One continuous infinity-knot loop in a single thick stroke: the left half is a soft organic curve (human), the right half is a squared path with sharp corners (agent); at the crossing the green stroke passes over itself with a white gap. Flat, uniform stroke.",
}
TAIL = {'clean': "", "mini": " Make it even simpler: reduce to the fewest possible shapes, maximum boldness, favicon-first design."}

def log(rec):
    with open(LOG, 'a') as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")

def gen(name, prompt):
    out = os.path.join(DR, name + '.png')
    if os.path.exists(out):
        print('skip', name); return True
    body = {"model": "google/gemini-3.1-flash-image",
            "messages": [{"role": "user", "content": prompt}],
            "modalities": ["image", "text"]}
    req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(body).encode(), method="POST",
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                d = json.load(r)
            ch = d['choices'][0]['message']
            imgs = ch.get('images') or []
            if imgs:
                u = (imgs[0].get('image_url') or {}).get('url', '')
                raw = base64.b64decode(u.split(',', 1)[1])
                open(out, 'wb').write(raw)
                log({"name": name, "tool": "nano_banana", "model": "google/gemini-3.1-flash-image",
                     "prompt": prompt, "ok": True})
                print('NB ok', name); return True
            print('NB no-image', name, json.dumps(d)[:150])
            log({"name": name, "tool": "nano_banana", "ok": False, "resp": json.dumps(d)[:400]})
        except Exception as e:
            print('NB err', name, str(e)[:140])
        time.sleep(5 * (attempt + 1))
    return False

if __name__ == '__main__':
    args = sys.argv[1:]
    names = args or [f"{k}_{t}" for k in BRIEFS for t in TAIL]
    failed = []
    for n in names:
        key, tail = n.rsplit('_', 1)
        if not gen(n, HARD + BRIEFS[key] + NEG + TAIL[tail]):
            failed.append(n)
    print('FAILED:', failed or 'none')

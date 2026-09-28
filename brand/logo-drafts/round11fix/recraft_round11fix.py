#!/usr/bin/env python3
"""Round 11-Fix 병행 트랙: Recraft 초안 (t_cde3ed12).
동일 컨셉(사람 원판 I + 에이전트 모난판 A, 280px 중첩, 꼬리 상호향, 2색)을 생성형으로
뽑아 수치 스펙 수작업판과 비교 — 대표님 병행 판단용 초안 3종. 파이프라인 round7 rc_gen 답습."""
import os, sys, json, time, urllib.request, urllib.error, base64, io
sys.path.append('/usr/lib/python3/dist-packages')
import cairosvg
from PIL import Image

HERE = '/home/holysky87/worldofagents/brand/logo-drafts/round11fix'
DST = os.path.join(HERE, 'drafts_rc')
os.makedirs(DST, exist_ok=True)
_ENV = os.path.expanduser('~/.hermes/profiles/photo/.env')
RC_KEY = [l.split('=', 1)[1].strip() for l in open(_ENV) if l.startswith('RECRAFT_API_KEY')][0]

HARD = ("Flat two-color vector logo, EXACTLY solid green #00A86B and pure white #FFFFFF, "
        "no gradients, no shading, no outlines beyond a thin green edge, no third color, "
        "no people, no figures, no robots, no frames, no texture. Square 1:1 white canvas. ")
CONCEPT = ("TWO SPEECH BUBBLES GENUINELY OVERLAPPING at the same height: LEFT = white CIRCLE bubble "
           "with thin green outline holding a bold green serif 'I'; RIGHT = solid green rounded-square "
           "bubble holding a bold white 'A'. The circle covers about half the square, so their "
           "intersection is a green lens (vesica). Each bubble has one triangular tail at its bottom "
           "pointing TOWARD the other bubble. Letters perfectly centered. ")
VARIANTS = {
    'rc1_overlap_lens': HARD + CONCEPT,
    'rc2_lens_invert': HARD + CONCEPT +
        "The lens overlap is the ONLY color inversion: circle white outside, green inside lens — crisp two-tone interlock.",
    'rc3_tight_tails': HARD + CONCEPT +
        "Tails are short fat triangles aiming at the lens, forming a dialogue V under the overlap; mark centered with generous margin.",
}

def rc_gen(name, prompt):
    out_svg = os.path.join(DST, name + '.svg')
    out_png = os.path.join(DST, name + '.png')
    for p in (out_svg, out_png):
        if os.path.exists(p): os.remove(p)
    body = {"prompt": prompt, "model": "recraftv3_vector", "style": "Vector art",
            "size": "1024x1024", "n": 1, "response_format": "url"}
    req = urllib.request.Request("https://external.api.recraft.ai/v1/images/generations/vector",
        data=json.dumps(body).encode(), method="POST",
        headers={"Authorization": f"Bearer {RC_KEY}", "Content-Type": "application/json"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                d = json.load(r)
            url = d['data'][0].get('url')
            if url:
                with urllib.request.urlopen(url, timeout=120) as f:
                    raw = f.read()
                if raw[:200].lstrip().startswith((b'<svg', b'<?xml')):
                    open(out_svg, 'wb').write(raw)
                    png = cairosvg.svg2png(bytestring=raw, output_width=1024, output_height=1024)
                    im = Image.open(io.BytesIO(png)).convert('RGBA')
                    bg = Image.new('RGBA', im.size, (255, 255, 255, 255))
                    Image.alpha_composite(bg, im).convert('RGB').save(out_png)
                    print('RC gen', name, 'ok'); return True
                print('RC not svg', name, raw[:60]); return False
            print('RC no-url', attempt + 1, name, json.dumps(d)[:200])
        except urllib.error.HTTPError as e:
            print('RC HTTP', e.code, name, e.read().decode()[:300])
            if e.code in (400, 401, 402, 422): return False
        except Exception as e:
            print('RC err', attempt + 1, name, str(e)[:150])
        time.sleep(5 * (attempt + 1))
    return False

if __name__ == '__main__':
    failed = [n for n in VARIANTS if not rc_gen(n, VARIANTS[n])]
    print('FAILED:', failed or 'none')

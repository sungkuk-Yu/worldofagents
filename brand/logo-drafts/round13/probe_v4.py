#!/usr/bin/env python3
import os, json, urllib.request, urllib.error
_ENV = os.path.expanduser('~/.hermes/profiles/photo/.env')
KEY = [l.split('=',1)[1].strip() for l in open(_ENV) if l.startswith('RECRAFT_API_KEY')][0]
trials = [("recraftv4_vector", None), ("recraftv4_vector", "vector art"),
          ("recraftv4", "Vector art")]
for m, s in trials:
    body = {"prompt": "flat green circle on white background, minimalist logo, two colors only",
            "model": m, "size": "1024x1024", "n": 1, "response_format": "url"}
    if s: body["style"] = s
    req = urllib.request.Request("https://external.api.recraft.ai/v1/images/generations/vector",
        data=json.dumps(body).encode(), method="POST",
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=150) as r:
            d = json.load(r)
        print(m, repr(s), "OK", str(d['data'][0].get('url',''))[:70])
        break
    except urllib.error.HTTPError as e:
        print(m, repr(s), "HTTP", e.code, e.read().decode()[:180])
    except Exception as e:
        print(m, repr(s), "ERR", str(e)[:140])

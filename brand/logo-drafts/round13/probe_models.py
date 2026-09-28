#!/usr/bin/env python3
"""Probe Recraft styles/models available with our key, and confirm cairosvg/PIL import."""
import os, json, urllib.request, sys
_ENV = os.path.expanduser('~/.hermes/profiles/photo/.env')
KEY = [l.split('=', 1)[1].strip() for l in open(_ENV) if l.startswith('RECRAFT_API_KEY')][0]
req = urllib.request.Request("https://external.api.recraft.ai/v1/styles",
    headers={"Authorization": f"Bearer {KEY}"})
try:
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.load(r)
    print(json.dumps(d, indent=1)[:2000])
except Exception as e:
    print("styles err", e)
try:
    import cairosvg
    from PIL import Image
    print("libs ok")
except Exception as e:
    print("libs err", e)

import re, pathlib
root = pathlib.Path('public')
bad = []
for p in root.rglob('*.html'):
    if 'wireframes' in str(p):
        continue
    txt = p.read_text(encoding='utf-8')
    for m in re.finditer(r'href="([^"#]+)[^"]*"', txt):
        h = m.group(1)
        if h.startswith(('http', 'mailto')):
            continue
        target = (root / h.lstrip('/')).resolve() if h.startswith('/') else (p.parent / h).resolve()
        if not target.exists() and not (target / 'index.html').exists():
            bad.append((str(p), h, 'missing'))
    for m in re.finditer(r'src="([^"]+)"', txt):
        h = m.group(1)
        if h.startswith(('http', 'data:')):
            continue
        target = (root / h.lstrip('/')).resolve() if h.startswith('/') else (p.parent / h).resolve()
        if not target.exists():
            bad.append((str(p), h, 'missing-src'))
for b in bad:
    print(b)
print('issues:', len(bad))

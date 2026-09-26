#!/usr/bin/env python3
"""Render docs/legal/*.md -> static HTML under public/myagenttalk/legal (Vercel-style chrome).
Usage: python3 scripts/render_legal.py
Idempotent: re-run after legal docs change."""
import pathlib
import re
import markdown

ROOT = pathlib.Path(__file__).resolve().parent.parent

DOCS = [
    # (src, out, lang, title)
    ("docs/legal/terms-of-service-ko.md", "public/myagenttalk/legal/terms.html", "ko", "마이에이전트톡 이용약관"),
    ("docs/legal/privacy-policy-ko.md", "public/myagenttalk/legal/privacy.html", "ko", "마이에이전트톡 개인정보처리방침"),
    ("docs/legal/terms-of-service-en.md", "public/myagenttalk/en/legal/terms.html", "en", "MyAgentTalk Terms of Service"),
    ("docs/legal/privacy-policy-en.md", "public/myagenttalk/en/legal/privacy.html", "en", "MyAgentTalk Privacy Policy"),
]

STYLE = """
  :root { --ink:#171717; --body:#4d4d4d; --muted:#666; --line:rgba(0,0,0,0.08); --bg:#ffffff; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font-family:'Geist','Inter','Pretendard',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    font-feature-settings:"liga"; line-height:1.6; -webkit-font-smoothing:antialiased; }
  a { color:#0072f5; text-decoration:none; } a:hover { text-decoration:underline; }
  .topbar { position:sticky; top:0; z-index:10; background:rgba(255,255,255,0.9); backdrop-filter:blur(8px);
    box-shadow:0 1px 0 var(--line); }
  .topbar-in { max-width:1120px; margin:0 auto; padding:14px 24px; display:flex; align-items:center; justify-content:space-between; }
  .brand { display:flex; align-items:center; gap:8px; font-weight:600; font-size:14px; letter-spacing:-0.28px; color:var(--ink); }
  .brand .dot { width:18px; height:18px; border-radius:4px; background:#171717; color:#fff; font-size:10px; font-weight:600; display:flex; align-items:center; justify-content:center; }
  .back { font-size:14px; font-weight:500; color:var(--ink); }
  main { max-width:760px; margin:0 auto; padding:56px 24px 120px; }
  h1,h2,h3 { letter-spacing:-0.96px; font-weight:600; color:var(--ink); }
  h1 { font-size:32px; line-height:1.25; margin:0 0 8px; }
  h2 { font-size:20px; margin:48px 0 12px; letter-spacing:-0.4px; }
  h3 { font-size:16px; margin:32px 0 8px; letter-spacing:-0.32px; }
  p,li { color:var(--body); font-size:15px; }
  blockquote { margin:16px 0; padding:14px 18px; background:#fafafa; border-radius:8px;
    box-shadow:0 0 0 1px var(--line); color:var(--body); font-size:14px; }
  blockquote p { margin:4px 0; }
  table { width:100%; border-collapse:separate; border-spacing:0; margin:20px 0; font-size:14px;
    box-shadow:0 0 0 1px var(--line); border-radius:8px; overflow:hidden; }
  th { text-align:left; background:#fafafa; font-weight:500; color:var(--ink); }
  th,td { padding:10px 14px; box-shadow:0 -1px 0 var(--line); color:var(--body); }
  hr { border:0; box-shadow:0 1px 0 var(--line); margin:40px 0; }
  code { font-family:'Geist Mono',ui-monospace,Menlo,monospace; font-size:13px; background:#f2f2f2; padding:2px 5px; border-radius:4px; }
  ul,ol { padding-left:22px; }
"""

PAGE = """<!DOCTYPE html>
<html lang="{lang}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>{title}</title>
<meta name="robots" content="noindex" />
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>{style}</style>
</head>
<body>
<div class="topbar"><div class="topbar-in">
  <div class="brand"><span class="dot">M</span> MyAgentTalk</div>
  <a class="back" href="{home_href}">&larr; {home_label}</a>
</div></div>
<main>
<h1>{title}</h1>
{body}
</main>
</body>
</html>
"""

HOME = {"ko": "랜딩으로", "en": "Back to landing"}

md = markdown.Markdown(extensions=["tables", "sane_lists", "attr_list"])

def unwrap_pseudo_links(html_text):
    """Legal drafts contain [text](이하 "회사") style pseudo-links that markdown renders as
    broken relative links — downgrade non-http/#/mailto anchors to plain text."""
    def fix(m):
        href, label = m.group(1), m.group(2)
        if href.startswith(("http", "#", "mailto", "/", "./", "../")):
            return m.group(0)
        return label
    return re.sub(r'<a href="([^"]*)"[^>]*>([^<]*)</a>', fix, html_text)

for src, out, lang, title in DOCS:
    md.reset()
    text = (ROOT / src).read_text(encoding="utf-8")
    body = unwrap_pseudo_links(md.convert(text))
    # drop the first h1 in the markdown (we render our own title)
    first = body.find("</h1>")
    if body.lstrip().startswith("<h1>") and first != -1:
        body = body[first + 5:]
    home_href = "/myagenttalk/" if lang == "ko" else "/myagenttalk/en/"
    html = PAGE.format(lang=lang, title=title, style=STYLE, body=body,
                       home_href=home_href, home_label=HOME[lang])
    dest = ROOT / out
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(html, encoding="utf-8")
    print("rendered", out, f"{len(html)} bytes")
print("done")

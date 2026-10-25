"""Validate both language routes, noindex boundaries, public metadata and shipped social cards."""

from pathlib import Path
import json, re, struct, sys, xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src/views"))
import localization as L

output = ROOT / "dist"
base = json.loads((ROOT / "data/site.json").read_text(encoding="utf-8"))[
    "site_url"
].rstrip("/")
urls = [
    n.text
    for n in ET.parse(output / "sitemap.xml")
    .getroot()
    .iter("{http://www.sitemaps.org/schemas/sitemap/0.9}loc")
]
assert len(urls) == len(set(urls)) == 98
for url in urls:
    path = url.removeprefix(base)
    locale = "zh-Hant" if path.startswith("/zh-hant/") else "en"
    route = path.removeprefix("/zh-hant").strip("/")
    html = (output / path.strip("/") / "index.html").read_text(encoding="utf-8")
    meta = L.metadata(route, locale, base)
    assert '<html lang="' + locale + '">' in html, url
    assert 'rel="canonical" href="' + url + '"' in html, url
    for lang in ["en", "zh-Hant", "x-default"]:
        assert 'hreflang="' + lang + '"' in html, url
    assert 'content="' + meta["image"] + '"' in html, url
    assert "google-site-verification" in html, url
    assert 'name="robots" content="noindex' not in html, url
    image = ROOT / "src" / meta["image"].removeprefix(base + "/")
    data = image.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n" and struct.unpack(">II", data[16:24]) == (
        1200,
        630,
    ), str(image)
    config = json.loads(
        re.search(
            r'<script id="site-locale-data" type="application/json">(.*?)</script>',
            html,
            re.S,
        )[1]
    )
    pack = json.loads(
        (output / config["packs"]["zh-Hant"].lstrip("/")).read_text(encoding="utf-8")
    )
    assert config["english"].keys() == pack.keys(), url
    if locale == "zh-Hant":
        assert config["messages"] == pack, url
    assert all(
        "/assets/fonts/" in item
        for item in re.findall(r'rel="preload" href="([^"]+)"', html)
    )
for prefix in ["", "zh-hant/"]:
    for route in ["profile", "workspace", "auth/callback", "404"]:
        html = (output / prefix / route / "index.html").read_text(encoding="utf-8")
        assert 'name="robots" content="noindex, follow"' in html
assert "Disallow:" not in (output / "robots.txt").read_text()
assert "@import" not in (ROOT / "src/styles/styles.css").read_text(encoding="utf-8")
index = json.loads((output / "assets/search-index.json").read_text(encoding="utf-8"))
assert len(index) == 43
assert {x["type"] for x in index} == {"tools", "games", "projects"}
print(
    "PASS 98 public URLs, 106 localized pages, per-route dictionary parity, canonical/hreflang, noindex, self-hosted fonts, 98 social PNGs and 43-entry public search"
)

"""Validate both language routes, noindex boundaries, public metadata and shipped social cards."""

from pathlib import Path
import json
import re
import struct
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True
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
# Generated content has one index per route and locale, plus a standalone 404.html.
# Assets can contain vendor HTML, so enumerate only the bilingual page directories.
page_files = {
    path.relative_to(output).parent.as_posix()
    for path in output.rglob("index.html")
    if path.relative_to(output).parts[0]
    not in {"assets", "vendor", "site", "tool-scripts", "game-scripts", "updates"}
}
excluded = {
    L.page_path(route, locale).strip("/")
    for route in ("profile", "workspace", "auth/callback", "404")
    for locale in L.LOCALES
}
expected = {
    base + ("/" if path == "." else f"/{path}/") for path in page_files - excluded
}
assert excluded <= page_files
assert len(urls) == len(set(urls)), "Duplicate sitemap URL"
assert set(urls) == expected, (expected - set(urls), set(urls) - expected)
images = set()

# These cases exercise late-loaded modules, explicit placeholders and Workspace.
messages_by_route = {
    "": ["Chess files could not load. Reload this page to retry."],
    "workspace": ["Favorited", "{0} · {1}/{2} known"],
    "tools/file-check": ["Hashing file {0} of {1}…"],
    "tools/file-renamer": ["Move {0} up", "Move {0} down"],
    "tools/data-studio": ["{0} / {1} · {2} rows"],
    "tools/flashcards": ["{0} / {1} known", "Card {0} / {1} · {2} known"],
    "tools/image-studio": [
        "Settings changed. Process the images again before downloading."
    ],
    "tools/typing-sprint": ["Practice"],
    "games/achievements": ["Unlocked"],
    "games/leaderboards": ["{0} · {1}×{1}"],
    "games/brick-breaker": ["{0} LIFE", "{0} LIVES"],
    "profile": ["{0} · {1} × {1}"],
}


def language_pack(html):
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
    return config, pack


def verify_pack(html, locale, route):
    config, pack = language_pack(html)
    assert config["english"].keys() == pack.keys(), (route, locale)
    if locale == "zh-Hant":
        assert config["messages"] == pack, route
    for source in messages_by_route.get(route, ()):
        key = L.key_for(source)
        assert config["english"].get(key) == source, (route, source)
        assert pack.get(key) == L.CATALOG[key]["zh-Hant"], (route, source)


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
    images.add(image)
    data = image.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n" and struct.unpack(">II", data[16:24]) == (
        1200,
        630,
    ), str(image)
    verify_pack(html, locale, route)
    assert all(
        "/assets/fonts/" in item
        for item in re.findall(r'rel="preload" href="([^"]+)"', html)
    )
for locale in L.LOCALES:
    prefix = "zh-hant/" if locale == "zh-Hant" else ""
    for route in ["profile", "workspace", "auth/callback", "404"]:
        html = (output / prefix / route / "index.html").read_text(encoding="utf-8")
        assert 'name="robots" content="noindex, follow"' in html
        verify_pack(html, locale, route)
assert "Disallow:" not in (output / "robots.txt").read_text()
assert "@import" not in (ROOT / "src/styles/styles.css").read_text(encoding="utf-8")
index = json.loads((output / "assets/search-index.json").read_text(encoding="utf-8"))
assert {x["route"] for x in index} == {L.page_path(route) for route in L.CONTENT}
assert len(index) == len(L.CONTENT)
assert {x["type"] for x in index} == {"tools", "games", "projects"}
assert all(isinstance(x.get("aliases"), list) for x in index)
print(
    f"PASS {len(urls)} public URLs, {len(page_files)} localized pages, "
    "per-route dictionary parity, canonical/hreflang, noindex, self-hosted fonts, "
    f"{len(images)} social PNGs and {len(index)} public search entries."
)

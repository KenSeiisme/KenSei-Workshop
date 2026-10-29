"""Check a clean build without changing the normal dist directory."""

from pathlib import Path
from html.parser import HTMLParser
import hashlib
import json
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class VerificationTags(HTMLParser):
    """Collect ownership tags and record whether they are inside the head."""

    def __init__(self):
        super().__init__()
        self.in_head = False
        self.tags = []

    def handle_starttag(self, tag, attrs):
        if tag == "head":
            self.in_head = True
        attributes = dict(attrs)
        if tag == "meta" and attributes.get("name") == "google-site-verification":
            self.tags.append((self.in_head, attributes.get("content")))

    def handle_endtag(self, tag):
        if tag == "head":
            self.in_head = False


qa = ROOT / "_qa"
qa.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix="structure-", dir=qa) as temporary:
    output = Path(temporary).resolve()
    # 临时清理只允许_qa 下本次创建的专用文件夹。
    assert output.is_relative_to(qa.resolve())
    assert output.name.startswith("structure-")
    subprocess.run(
        [sys.executable, "-X", "utf8", str(ROOT / "build.py"), "--output", str(output)],
        check=True,
    )
    tools = json.loads((ROOT / "data/tools.json").read_text(encoding="utf-8"))
    assert len({tool[0] for tool in tools}) == len(tools)
    for slug, *_ in tools:
        assert (output / "tools" / slug / "index.html").is_file(), slug
    games = json.loads((ROOT / "data/games.json").read_text(encoding="utf-8"))
    for game in games:
        assert (output / "games" / game["slug"] / "index.html").is_file()
    assert (output / "games/index.html").is_file()
    for name in ("app.js", "config.js"):
        assert digest(SOURCE / name) == digest(output / name), name
    for path in (SOURCE / "styles").glob("*.css"):
        assert digest(path) == digest(output / path.name), path.name
    for source, public in (
        ("assets", "assets"),
        ("tools", "tool-scripts"),
        ("games", "game-scripts"),
        ("vendor", "vendor"),
        ("site", "site"),
    ):
        for path in (SOURCE / source).rglob("*"):
            if (
                not path.is_file()
                or "__pycache__" in path.parts
                or path.name.endswith((".pyc", ".tar.gz"))
            ):
                continue
            relative = path.relative_to(SOURCE / source)
            assert digest(path) == digest(output / public / relative), str(relative)
    for forbidden in (
        ".env.local",
        "src",
        "scripts",
        "data",
        "supabase",
        "tests",
        "package.json",
    ):
        assert not (output / forbidden).exists(), forbidden
    assert (output / "auth/callback/index.html").is_file()
    assert (output / "workspace/index.html").is_file()
    assert (output / "profile/index.html").is_file()
    verification = json.loads((ROOT / "data/site.json").read_text(encoding="utf-8"))[
        "google_site_verification"
    ]
    pages = [
        path
        for path in output.rglob("*.html")
        if path.relative_to(output).parts[0]
        not in {"vendor", "tool-scripts", "game-scripts", "assets"}
    ]
    for path in pages:
        parser = VerificationTags()
        parser.feed(path.read_text(encoding="utf-8"))
        assert parser.tags == [(True, verification)], str(path.relative_to(output))
    site_url = json.loads((ROOT / "data/site.json").read_text(encoding="utf-8"))[
        "site_url"
    ].rstrip("/")
    namespace = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
    sitemap = ET.parse(output / "sitemap.xml").getroot()
    assert sitemap.tag == namespace + "urlset"
    locations = [entry.findtext(namespace + "loc") for entry in sitemap]
    expected_locations = set()
    for path in pages:
        relative = path.relative_to(output)
        logical_parts = (
            relative.parts[1:] if relative.parts[0] == "zh-hant" else relative.parts
        )
        if logical_parts[0] in {"workspace", "auth", "profile", "404", "404.html"}:
            continue
        assert path.name == "index.html", str(relative)
        route = relative.parent.as_posix()
        expected_locations.add(site_url + ("/" if route == "." else f"/{route}/"))
    assert len(locations) == len(set(locations)), "Duplicate sitemap URLs"
    assert set(locations) == expected_locations, "Sitemap differs from public pages"
    for location in locations:
        url = urlsplit(location)
        assert url.scheme == "https" and url.netloc == urlsplit(site_url).netloc
        assert not url.query and not url.fragment and url.path.endswith("/")
    robots = (output / "robots.txt").read_text(encoding="utf-8")
    assert robots.count(f"Sitemap: {site_url}/sitemap.xml") == 1
    assert "Disallow:" not in robots
    assert len(locations) == 100
    # Studio adds one public page per locale and a real immutable download feed.
    studio = json.loads(
        (ROOT / "data/kensei-studio/download.json").read_text(encoding="utf-8")
    )
    assert studio["bytes"] > 0 and len(studio["sha256"]) == 64
    feed = (output / "updates/kensei-studio/windows/x64/latest.yml").read_text(
        encoding="utf-8"
    )
    assert studio["downloadUrl"] in feed and studio["sha512"] in feed
    assert (output / "updates/kensei-studio/windows/x64/releases.json").is_file()
    for prefix in ("", "zh-hant/"):
        page = (output / prefix / "projects/kensei-studio/index.html").read_text(
            encoding="utf-8"
        )
        assert studio["downloadUrl"] in page and studio["sha256"] in page
    for prefix in ("", "zh-hant/"):
        for route in ("workspace", "profile", "auth/callback", "404"):
            assert 'name="robots" content="noindex, follow"' in (
                output / prefix / route / "index.html"
            ).read_text(encoding="utf-8")
    print(
        f"PASS clean build: {len(tools)} tools, {len(games)} games, "
        f"ownership tag in the head of all {len(pages)} pages, "
        f"{len(locations)} public sitemap URLs and robots declaration, unchanged public "
        "asset paths, complete vendor assets and no private source files."
    )

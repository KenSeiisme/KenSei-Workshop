"""Download page and immutable release metadata, generated from the App release catalog."""

from pathlib import Path
from html import escape
import json
import shutil
import hashlib
import re
from urllib.parse import urlsplit
import localization as i18n

ROOT = Path(__file__).resolve().parents[2]

# Every new release is translated from the same exported catalog at build time.
for release in json.loads(
    (ROOT / "data/kensei-studio/releases.json").read_text(encoding="utf-8")
):
    for category in ("added", "improved", "fixed"):
        for english, chinese in zip(
            release["changes"]["en"][category], release["changes"]["zh-TW"][category]
        ):
            key = (
                "m_"
                + hashlib.sha256(" ".join(english.split()).encode()).hexdigest()[:12]
            )
            i18n.CATALOG[key] = {"en": english, "zh-Hant": chinese}
            i18n.ENGLISH[key] = english


def view():
    data = ROOT / "data/kensei-studio"
    info = json.loads((data / "download.json").read_text(encoding="utf-8"))
    notes = json.loads((data / "releases.json").read_text(encoding="utf-8"))
    address = urlsplit(info["downloadUrl"])
    if not (
        address.scheme == "https"
        and address.netloc.endswith(".public.blob.vercel-storage.com")
        and info["bytes"] > 0
        and re.fullmatch(r"[0-9a-f]{64}", info["sha256"])
        and notes[0]["version"] == info["version"]
    ):
        raise ValueError(
            "Publish a verified installer and matching release catalog before building the download page."
        )
    history = []
    for note in notes:
        sections = []
        for key in ("added", "improved", "fixed"):
            values = note["changes"]["en"][key]
            if values:
                sections.append(
                    "<h3>"
                    + key.title()
                    + "</h3><ul>"
                    + "".join("<li>" + escape(text) + "</li>" for text in values)
                    + "</ul>"
                )
        history.append(
            '<details class="studio-release"'
            + (" open" if note == notes[0] else "")
            + "><summary>KenSei Studio "
            + escape(note["version"])
            + " <time>"
            + escape(note["date"])
            + "</time></summary>"
            + "".join(sections)
            + "</details>"
        )
    url = escape(info["downloadUrl"], quote=True)
    version = escape(info["version"])
    size = round(info["bytes"] / 1048576, 1)
    digest = escape(info["sha256"])
    return f"""<article class="container page-section studio-page">
<a href="/projects/" class="back-link">← All projects</a>
<div class="detail-heading"><div><div class="eyebrow">WINDOWS / DESKTOP APP</div><h1>KenSei Studio</h1><p>Turn sound into light.</p></div><a class="button primary" href="{url}" download>Download for Windows x64 ↧</a></div>
<p class="studio-meta">Version <strong>{version}</strong> · <time>{info['date']}</time> · {size} MB · Windows 10 / 11</p>
<div class="studio-preview"><img src="/assets/kensei-studio/preview.png" alt="KenSei Studio show editor and LED preview" width="1560" height="1000"></div>
<div class="detail-columns"><section><h2>Music, light, and your next show.</h2><p>Arrange lightsaber effects to music, preview every LED, and build offline ESP32-C3 lighting programs with ESPHome.</p><ul><li>Local audio, beat analysis and independent prop timelines.</li><li>Immediate preview with parameter effects and pixel keyframes.</li><li>Right-click management for props and songs.</li><li>Per-song mute and volume, plus an App master volume.</li><li>17 lighting algorithms and 24 Arctic, Neon and Ember presets.</li><li>English, Simplified Chinese and Traditional Chinese.</li><li>Compile, export and flash over USB.</li></ul></section><aside class="panel"><h2>Install and keep creating</h2><p>Install this version once to enable future updates inside the app.</p><p>Your .saberproj files, recovery data and build environment are preserved.</p><h3>SHA-256</h3><code class="studio-checksum">{digest}</code></aside></div>
<section class="studio-history"><h2>Release notes</h2>{''.join(history)}</section>
</article>"""


def copy_update_feed(output):
    source = ROOT / "data/kensei-studio"
    target = output / "updates/kensei-studio/windows/x64"
    target.mkdir(parents=True, exist_ok=True)
    for name in ("latest.yml", "releases.json", "download.json"):
        if (source / name).exists():
            shutil.copyfile(source / name, target / name)

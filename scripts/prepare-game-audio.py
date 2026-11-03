"""Prepare pinned CC0 game audio. Development-only: Python stdlib and FFmpeg 7.1+.

Raw sources stay in ignored _qa/game-audio. Production only copies the prepared files.
Run with --check to verify existing assets without changing tracked files.
"""

import argparse
import array
import hashlib
import http.cookiejar
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import sys
import urllib.request
import wave
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "_qa/game-audio"
OUTPUT = ROOT / "src/assets/game-audio"
LICENSE = "https://creativecommons.org/publicdomain/zero/1.0/"
PACKS = {
    "interface-sounds": "f2193d072726d6758a5f7871b2dcc54dcce0d5c35c6f0a62f92549b327c81232",
    "casino-audio": "f36250766ac5bc378c13708ddf12a23a8e54a3251f8d482c7536e51b5dbafa18",
    "digital-audio": "24e6ce28b76a6d8c89cff4d331e0965ff5c3de8a73c612028e9d363cc64e4f06",
    "music-jingles": "b729ba57959bd58793d2c5cafa348aaf2655d354f3da35ec4729e03ec77197b8",
}
MUSIC = {
    "board": (
        "Easy Going Music Loop",
        "Seth_Makes_Sounds",
        "691837",
        "13228046",
        "a05578bc5d571198d4babc4ef8585640ce3de7e040cfc26567ce3f59b1173d70",
        4,
    ),
    "puzzle": (
        "Retro Game Music 90BPM Loop - Bass, Lead, Pad and Keys",
        "Jadis0x",
        "859283",
        "11915007",
        "00a58a9932c6cffa5bf4802ab8957b86c07133889df32248341d330ffb27fed3",
        1,
    ),
    "arcade": (
        "Simple Game Music Loop",
        "Seth_Makes_Sounds",
        "684511",
        "13228046",
        "f8ab7378d98567517cef4c05ca14f8c81f5892809e43fb2062300a6efc0a4698",
        2,
    ),
}
# 输出名、来源包、来源文件、最长时长、默认相对增益。
SAMPLES = {
    **{
        f"stone-{n}": ("casino-audio", f"chip-lay-{n}.ogg", 0.25, 0.9)
        for n in (1, 2, 3)
    },
    **{
        f"card-{n}": ("casino-audio", f"card-place-{n}.ogg", 0.32, 0.8)
        for n in (1, 2, 3)
    },
    "capture": ("casino-audio", "chips-stack-1.ogg", 0.38, 0.9),
    "soft-1": ("interface-sounds", "pluck_001.ogg", 0.2, 0.65),
    "soft-2": ("interface-sounds", "pluck_002.ogg", 0.2, 0.65),
    "soft-3": ("interface-sounds", "select_001.ogg", 0.2, 0.65),
    "tick": ("interface-sounds", "tick_001.ogg", 0.14, 0.55),
    "erase": ("interface-sounds", "back_002.ogg", 0.2, 0.65),
    "confirm": ("interface-sounds", "confirmation_001.ogg", 0.38, 0.8),
    "error": ("interface-sounds", "error_004.ogg", 0.3, 0.75),
    "flag": ("interface-sounds", "switch_001.ogg", 0.24, 0.75),
    "turn": ("interface-sounds", "bong_001.ogg", 0.36, 0.7),
    **{
        f"collision-{n}": ("digital-audio", f"pepSound{n}.ogg", 0.18, 0.75)
        for n in (1, 2, 3)
    },
    "serve": ("digital-audio", "highUp.ogg", 0.32, 0.8),
    "arcade-point": ("digital-audio", "threeTone1.ogg", 0.4, 0.85),
    "multiball": ("digital-audio", "powerUp3.ogg", 0.45, 0.9),
    "wide": ("digital-audio", "powerUp4.ogg", 0.45, 0.9),
    "slow": ("digital-audio", "powerUp6.ogg", 0.45, 0.85),
    "rotate": ("digital-audio", "tone1.ogg", 0.15, 0.55),
    "harddrop": ("digital-audio", "lowDown.ogg", 0.26, 0.9),
    "life": ("digital-audio", "phaserDown1.ogg", 0.45, 0.9),
    "gentle-win": ("music-jingles", "Pizzicato jingles/jingles_PIZZI10.ogg", 1.0, 0.85),
    "gentle-loss": ("music-jingles", "Pizzicato jingles/jingles_PIZZI11.ogg", 1.0, 0.8),
    "gentle-draw": ("music-jingles", "Pizzicato jingles/jingles_PIZZI16.ogg", 0.8, 0.8),
    "gentle-over": ("music-jingles", "Pizzicato jingles/jingles_PIZZI00.ogg", 0.8, 0.8),
    "arcade-win": ("music-jingles", "8-Bit jingles/jingles_NES03.ogg", 1.0, 0.9),
    "arcade-loss": ("music-jingles", "8-Bit jingles/jingles_NES04.ogg", 1.0, 0.8),
    "arcade-over": ("music-jingles", "8-Bit jingles/jingles_NES11.ogg", 1.0, 0.8),
    "arcade-draw": ("music-jingles", "8-Bit jingles/jingles_NES01.ogg", 0.8, 0.8),
    "milestone": ("music-jingles", "8-Bit jingles/jingles_NES12.ogg", 1.0, 0.9),
}
KINDS = "move merge reveal flag flip pair miss input erase conflict line brick paddle serve point pickup multiball wide slow life win over loss draw milestone rotate harddrop capture pass turn pause reconnect countdown end".split()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fetch(opener, url, referer=None):
    headers = {"User-Agent": "Mozilla/5.0 (KenSei Workshop CC0 asset preparation)"}
    if referer:
        headers["Referer"] = referer
    with opener.open(
        urllib.request.Request(url, headers=headers), timeout=90
    ) as response:
        return response.read()


def sources():
    CACHE.mkdir(parents=True, exist_ok=True)
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
    )
    for family, (title, author, ident, owner, expected, divisor) in MUSIC.items():
        file = CACHE / f"{family}.mp3"
        if not file.is_file():
            file.write_bytes(
                fetch(
                    opener,
                    f"https://cdn.freesound.org/previews/{ident[:3]}/{ident}_{owner}-hq.mp3",
                )
            )
        if digest(file) != expected:
            raise ValueError(
                f"Pinned music changed: {family}; review its license before changing the source hash"
            )
    for slug, expected in PACKS.items():
        file = CACHE / f"{slug}.zip"
        if not file.is_file():
            page = f"https://kenney.nl/assets/{slug}"
            html = fetch(opener, page).decode()
            ident = re.search(r"data-download-id=[\"']([^\"']+)", html).group(1)
            info = json.loads(
                fetch(opener, f"https://kenney.nl/download-link/{ident}", page)
            )
            file.write_bytes(fetch(opener, info["url"], page))
        if digest(file) != expected:
            raise ValueError(
                f"Pinned archive changed: {slug}; review it before updating the hash"
            )
        folder = (CACHE / slug).resolve()
        with zipfile.ZipFile(file) as package:
            for item in package.infolist():
                if (
                    not (folder / item.filename).resolve().is_relative_to(folder)
                    or (item.external_attr >> 16) & 0o170000 == 0o120000
                ):
                    raise ValueError("Unsafe archive member")
            package.extractall(folder)


def run(ffmpeg, *args):
    return subprocess.check_output(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", *map(str, args)]
    )


def floats(ffmpeg, source, channels=1, rate=44100, filters=None):
    args = ["-i", source]
    if filters:
        args += ["-af", filters]
    data = array.array(
        "f", run(ffmpeg, *args, "-f", "f32le", "-ac", channels, "-ar", rate, "-")
    )
    if sys.byteorder != "little":
        data.byteswap()
    return data


def descriptor(file, duration, gain=1, **extra):
    return {
        "file": file.name,
        "bytes": file.stat().st_size,
        "sha256": digest(file),
        "duration": round(duration, 6),
        "gain": gain,
        **extra,
    }


def sample(ffmpeg, name, definition):
    pack, relative, limit, gain = definition
    source = CACHE / pack / "Audio" / relative
    pcm = floats(ffmpeg, source, filters="highpass=f=70,lowpass=f=9500")
    active = [i for i, value in enumerate(pcm) if abs(value) > 0.002]
    if not active:
        raise ValueError(f"Silent source: {name}")
    first, last = max(0, active[0] - 44), min(len(pcm), active[-1] + 442)
    pcm = pcm[first : min(last, first + round(limit * 44100))]
    peak = max(map(abs, pcm))
    factor = (10 ** (-12 / 20)) / peak
    attack, release = min(90, len(pcm) // 4), min(441, len(pcm) // 4)
    output = array.array("h")
    for i, value in enumerate(pcm):
        envelope = min(1, i / max(1, attack), (len(pcm) - 1 - i) / max(1, release))
        output.append(round(max(-1, min(1, value * factor * envelope)) * 32767))
    file = OUTPUT / f"{name}.wav"
    if sys.byteorder != "little":
        output.byteswap()
    with wave.open(str(file), "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(44100)
        writer.writeframes(output.tobytes())
    return descriptor(
        file,
        len(pcm) / 44100,
        gain,
        source=pack,
        sourceFile="Audio/" + relative,
        sourceSha256=digest(source),
        peakDbfs=-12,
    )


def music(ffmpeg, family, definition):
    title, author, ident, owner, expected, divisor = definition
    raw = CACHE / f"{family}.mp3"
    total = len(floats(ffmpeg, raw, channels=2)) / (44100 * 2)
    duration = total / divisor
    if not 30 <= duration <= 60:
        raise ValueError(
            f"Loop outside the intended musical duration: {family} {duration}"
        )
    file = OUTPUT / f"{family}-loop.mp3"
    # Divide complete source loops into equal musical phrases; preserve duration, taper only 3ms at either edge.
    filters = f"atrim=duration={duration:.9f},asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-3:LRA=9,afade=t=in:d=0.003,afade=t=out:st={duration - 0.003:.9f}:d=0.003"
    run(
        ffmpeg,
        "-y",
        "-i",
        raw,
        "-af",
        filters,
        "-ar",
        "44100",
        "-ac",
        "2",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "96k",
        "-map_metadata",
        "-1",
        "-id3v2_version",
        "0",
        "-write_xing",
        "1",
        file,
    )
    actual = floats(ffmpeg, file, channels=2)
    length = len(actual) / 88200
    peak = max(map(abs, actual))
    edge = max(abs(actual[0]), abs(actual[1]), abs(actual[-1]), abs(actual[-2]))
    return descriptor(
        file,
        length,
        loopStart=0,
        loopEnd=round(length, 6),
        source=f"music-{family}",
        peakDbfs=round(20 * math.log10(max(peak, 1e-9)), 3),
        seamEndpointPeak=round(edge, 6),
        processing=f"First 1/{divisor} of complete original loop; -16 LUFS / -3 dBTP target; 3ms endpoint tapers; 96kbps MP3 with gapless metadata",
    )


def cue_map(family, assets):
    defaults = {
        "board": ["stone-1", "stone-2", "stone-3"],
        "puzzle": ["soft-1", "soft-2", "soft-3"],
        "arcade": ["collision-1", "collision-2", "collision-3"],
    }
    mapping = {kind: defaults[family] for kind in KINDS}
    mapping.update(
        {
            "flag": ["flag"],
            "flip": ["card-1", "card-2", "card-3"],
            "erase": ["erase"],
            "miss": ["error"],
            "conflict": ["error"],
            "pair": ["confirm"],
            "pass": ["erase"],
            "turn": ["turn"],
            "pause": ["erase"],
            "reconnect": ["confirm"],
            "countdown": ["tick"],
            "capture": ["capture"],
            "pickup": ["confirm"],
            "line": ["confirm"],
            "point": ["confirm"],
            "input": ["tick"],
            "rotate": ["tick"],
            "harddrop": ["capture"],
            "serve": ["confirm"],
            "multiball": ["confirm"],
            "wide": ["confirm"],
            "slow": ["confirm"],
            "life": ["error"],
        }
    )
    tone = "arcade" if family == "arcade" else "gentle"
    mapping.update(
        {kind: [f"{tone}-{kind}"] for kind in ["win", "loss", "draw", "over"]}
    )
    mapping["end"] = [f"{tone}-over"]
    mapping["milestone"] = ["milestone" if family == "arcade" else "gentle-win"]
    if family == "arcade":
        mapping.update(
            {
                key: [key]
                for key in [
                    "serve",
                    "rotate",
                    "harddrop",
                    "multiball",
                    "wide",
                    "slow",
                    "life",
                ]
            }
        )
        mapping.update(
            {
                "point": ["arcade-point"],
                "line": ["arcade-point"],
                "pickup": ["multiball"],
                "pair": ["arcade-point"],
            }
        )
    if family == "board":
        mapping["flip"] = ["stone-1", "stone-2", "stone-3"]
    return {kind: [assets[name] for name in names] for kind, names in mapping.items()}


def validate(ffmpeg, manifest):
    report = {}
    for family, profile in manifest["profiles"].items():
        unique = {
            item["file"]: item
            for choices in profile["cues"].values()
            for item in choices
        }
        unique[profile["music"]["file"]] = profile["music"]
        size, decoded = 0, 0
        for filename, item in unique.items():
            file = (OUTPUT / filename).resolve()
            if (
                not file.is_relative_to(OUTPUT.resolve())
                or digest(file) != item["sha256"]
                or file.stat().st_size != item["bytes"]
            ):
                raise ValueError(f"Changed or unsafe prepared asset: {filename}")
            size += item["bytes"]
            channels = 2 if file.suffix == ".mp3" else 1
            pcm = floats(ffmpeg, file, channels=channels, rate=48000)
            if max(map(abs, pcm), default=0) >= 0.99:
                raise ValueError(f"Clipping asset: {filename}")
            decoded += len(pcm) * 4
        if size > 2_000_000 or decoded > 32 * 1024 * 1024:
            raise ValueError(
                f"Profile over budget: {family}: {size} bytes, {decoded} decoded"
            )
        report[family] = {
            "uniqueFiles": len(unique),
            "downloadBytes": size,
            "decodedPcmBytesAt48000Hz": decoded,
        }
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg"))
    options = parser.parse_args()
    if not options.ffmpeg:
        parser.error(
            "FFmpeg is needed only to prepare / inspect assets; production needs no codec installation"
        )
    if options.check:
        manifest = json.loads((OUTPUT / "manifest.json").read_text(encoding="utf-8"))
        print(json.dumps(validate(options.ffmpeg, manifest), indent=2))
        return
    sources()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    assets = {
        name: sample(options.ffmpeg, name, definition)
        for name, definition in SAMPLES.items()
    }
    profiles = {
        family: {
            "music": music(options.ffmpeg, family, definition),
            "cues": cue_map(family, assets),
        }
        for family, definition in MUSIC.items()
    }
    credits = [
        {
            "id": slug,
            "title": slug.replace("-", " ").title(),
            "author": "Kenney",
            "url": f"https://kenney.nl/assets/{slug}",
            "license": "CC0-1.0",
            "licenseUrl": LICENSE,
            "sourceArchiveSha256": expected,
            "processing": "Individual one-shots: silence trimmed, mono 44.1kHz PCM16, 70Hz high-pass / 9.5kHz low-pass, -12dBFS peak normalization, 2ms attack / 10ms release tapers",
        }
        for slug, expected in PACKS.items()
    ]
    credits.extend(
        {
            "id": f"music-{family}",
            "title": definition[0],
            "author": definition[1],
            "url": f"https://freesound.org/people/{definition[1]}/sounds/{definition[2]}/",
            "downloadUrl": f"https://cdn.freesound.org/previews/{definition[2][:3]}/{definition[2]}_{definition[3]}-hq.mp3",
            "license": "CC0-1.0",
            "licenseUrl": LICENSE,
            "sourceSha256": definition[4],
            "processing": profiles[family]["music"]["processing"],
        }
        for family, definition in MUSIC.items()
    )
    manifest = {
        "version": 1,
        "preparedWith": "FFmpeg 7.1.1; Python standard library",
        "profiles": profiles,
        "sources": credits,
        "verification": {
            "subjectiveListening": "Pending headphones, speakers and physical Android; waveform checks are separate",
            "budgets": validate(options.ffmpeg, {"profiles": profiles}),
        },
    }
    (OUTPUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    licenses = OUTPUT / "licenses"
    licenses.mkdir(exist_ok=True)
    for slug in PACKS:
        shutil.copyfile(CACHE / slug / "License.txt", licenses / f"kenney-{slug}.txt")
    print(json.dumps(manifest["verification"], indent=2))


if __name__ == "__main__":
    main()

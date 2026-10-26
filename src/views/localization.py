"""Static bilingual pages and small page-specific locale assets (standard library only)."""

from pathlib import Path
from html import escape
from html.parser import HTMLParser
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "src"
LOCALES = ("en", "zh-Hant")
CATALOG = {}
for file in sorted((SOURCE / "i18n/catalog").glob("*.json")):
    CATALOG.update(json.loads(file.read_text(encoding="utf-8")))
for key, value in CATALOG.items():
    if not all(isinstance(value.get(lang), str) and value[lang] for lang in LOCALES):
        raise ValueError("Incomplete locale key: " + key)
    if sorted(re.findall(r"\{\d+\}", value["en"])) != sorted(
        re.findall(r"\{\d+\}", value["zh-Hant"])
    ):
        raise ValueError("Locale placeholders differ: " + key)
CONTENT = json.loads((SOURCE / "i18n/content.json").read_text(encoding="utf-8"))
USAGE = json.loads((SOURCE / "i18n/usage.json").read_text(encoding="utf-8"))


def normalized(text):
    return re.sub(r"\s+", " ", text).strip()


def key_for(text):
    return "m_" + hashlib.sha256(normalized(text).encode()).hexdigest()[:12]


def translate(text, locale):
    value = CATALOG.get(key_for(text))
    return value.get(locale, text) if value else text


COMMON = {
    "": (
        {"en": "Useful tools for everyday things", "zh-Hant": "實用工具，讓日常更順手"},
        {
            "en": "Free browser tools for files, text, images and everyday tasks, plus a separate collection of casual games.",
            "zh-Hant": "免費瀏覽器工具，處理檔案、文字、圖片與日常工作，另設休閒小遊戲專區。",
        },
    ),
    "tools": (
        {"en": "Tools", "zh-Hant": "工具"},
        {
            "en": "Find 28 browser tools for files, images, text, learning and everyday tasks.",
            "zh-Hant": "探索 28 個瀏覽器工具，輕鬆處理檔案、圖片、文字、學習與日常工作。",
        },
    ),
    "games": (
        {"en": "Games", "zh-Hant": "遊戲"},
        {
            "en": "Play 12 browser games with local saves and verified leaderboards for eligible signed-in runs.",
            "zh-Hant": "暢玩 12 款瀏覽器遊戲，支援本機存檔，合資格的登入對局可加入已驗證排行榜。",
        },
    ),
    "projects": (
        {"en": "Projects", "zh-Hant": "作品"},
        {
            "en": "Explore KenSei’s website, software and creative projects.",
            "zh-Hant": "探索 KenSei 的網站、軟體與創意作品。",
        },
    ),
    "workspace": (
        {"en": "Your workspace", "zh-Hant": "你的工作區"},
        {
            "en": "Your private favorites, drafts, learning plans and saved browser-tool records.",
            "zh-Hant": "管理你的私人收藏、草稿、學習計畫與工具記錄。",
        },
    ),
    "profile": (
        {"en": "Profile", "zh-Hant": "個人資料"},
        {
            "en": "Manage your KenSei Workshop profile and view public verified results.",
            "zh-Hant": "管理 KenSei Workshop 個人資料，查看公開的已驗證成績。",
        },
    ),
    "privacy": (
        {"en": "Privacy", "zh-Hant": "隱私說明"},
        {
            "en": "How local processing, account sync, network testing and public results work at KenSei Workshop.",
            "zh-Hant": "了解 KenSei Workshop 的本機處理、帳號同步、網路測速與公開成績。",
        },
    ),
    "credits": (
        {"en": "Open-source credits", "zh-Hant": "開源致謝"},
        {
            "en": "Open-source projects, fonts and licenses used by KenSei Workshop.",
            "zh-Hant": "KenSei Workshop 使用的開源專案、字體與授權。",
        },
    ),
    "auth/callback": (
        {"en": "Signing in", "zh-Hant": "正在登入"},
        {"en": "Completing your sign-in securely.", "zh-Hant": "正在安全地完成登入。"},
    ),
    "404": (
        {"en": "Page not found", "zh-Hant": "找不到頁面"},
        {"en": "This page could not be found.", "zh-Hant": "找不到這個頁面。"},
    ),
}
# Product names are presentation metadata, never identifiers or saved user content.
for item in CONTENT.values():
    for field in ["name", "description"]:
        values = item[field]
        CATALOG[key_for(values["en"])] = {
            "en": values["en"],
            "zh-Hant": values["zh-Hant"],
        }
for names, descriptions in COMMON.values():
    for values in [names, descriptions]:
        CATALOG[key_for(values["en"])] = values
for key, value in list(CATALOG.items()):
    if key.startswith("site."):
        CATALOG[key_for(value["en"])] = value
ENGLISH = {key: value["en"] for key, value in CATALOG.items()}


class Annotator(HTMLParser):
    def __init__(self, locale):
        super().__init__(convert_charrefs=True)
        self.locale = locale
        self.result = []
        self.protected = []
        self.keys = set()

    def handle_decl(self, decl):
        self.result.append("<!" + decl + ">")

    def handle_comment(self, text):
        self.result.append("<!--" + text + "-->")

    def handle_starttag(self, tag, attrs):
        if tag in ["script", "style", "textarea", "pre", "code"]:
            self.protected.append(tag)
        values = []
        markers = {}
        for name, value in attrs:
            if (
                value is not None
                and name in ["aria-label", "title", "placeholder", "alt"]
                and not self.protected
            ):
                key = key_for(value)
                if key in CATALOG:
                    markers[name] = key
                    self.keys.add(key)
                    value = translate(value, self.locale)
            values.append(
                name if value is None else name + '="' + escape(value, quote=True) + '"'
            )
        if markers:
            values.append(
                "data-ui-attrs='" + json.dumps(markers, separators=(",", ":")) + "'"
            )
        self.result.append("<" + tag + (" " + " ".join(values) if values else "") + ">")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.result[-1] = self.result[-1][:-1] + " />"
        if tag in self.protected:
            self.protected.remove(tag)

    def handle_endtag(self, tag):
        self.result.append("</" + tag + ">")
        if self.protected and self.protected[-1] == tag:
            self.protected.pop()

    def handle_data(self, value):
        if self.protected:
            self.result.append(
                value if self.protected[-1] in ["script", "style"] else escape(value)
            )
            return
        key = key_for(value)
        if key not in CATALOG:
            self.result.append(value)
            return
        self.keys.add(key)
        leading = re.match(r"^\s*", value).group()
        trailing = re.search(r"\s*$", value).group()
        self.result.append(
            leading
            + "<!--ui:"
            + key
            + "-->"
            + escape(translate(normalized(value), self.locale))
            + trailing
        )

    def handle_entityref(self, name):
        self.result.append("&" + name + ";")

    def handle_charref(self, name):
        self.result.append("&#" + name + ";")

    def output(self):
        return "".join(self.result)


def is_public(route):
    return route.split("/")[0] not in {"auth", "workspace", "profile", "404"}


def page_path(route, locale="en"):
    path = "/" + route.strip("/") + "/" if route else "/"
    return "/zh-hant" + path if locale == "zh-Hant" else path


def metadata(route, locale, site_url):
    if route in CONTENT:
        names = CONTENT[route]["name"]
        descriptions = CONTENT[route]["description"]
    else:
        names, descriptions = COMMON.get(route, COMMON["404"])
    slug = route.replace("/", "-") or "home"
    return {
        "title": names[locale] + " — KenSei Workshop",
        "description": descriptions[locale],
        "url": site_url + page_path(route, locale),
        "image": site_url
        + "/assets/og/"
        + ("zh-hant" if locale == "zh-Hant" else "en")
        + "/"
        + slug
        + ".png",
    }


def styles(route):
    files = ["styles.css", "site.css"]
    if route.startswith("tools/") or route == "workspace":
        files.append("tools.css")
    if route.startswith("tools/"):
        files.append("tool-experience.css")
        slug = route.split("/")[-1]
        if slug == "study-planner":
            files.append("planner.css")
        if slug == "whiteboard":
            files.append("whiteboard.css")
        if slug == "typing-sprint":
            files.append("typing-sprint.css")
        if slug in ["audio-studio", "screen-recorder", "qr-studio"]:
            files.append("media.css")
    if route == "workspace":
        files += ["planner.css", "whiteboard.css"]
    if route == "profile":
        files += [
            "profile.css",
            "game-neon.css",
            "game-next.css",
            "game-experience.css",
        ]
    if route == "games" or route.startswith("games/"):
        files += ["games.css", "game-neon.css", "game-next.css", "game-experience.css"]
        slug = route.split("/")[-1]
        if slug in ["sudoku", "nonogram"]:
            files.append("puzzle-games.css")
        if slug in ["block-puzzle", "brick-breaker"]:
            files.append("arcade-games.css")
        if slug in ["connect-four", "reversi"]:
            files.append("board-games.css")
        if route.startswith("games/"):
            files.append("game-play-shell.css")
    return files


def source_files(route):
    files = {"src/app.js"}
    if route.startswith("tools/"):
        slug = route.split("/")[-1]
        files.add("src/tools/" + slug + ".js")
        files.update(
            "src/tools/" + name
            for name in [
                "tool-ui.js",
                "tool-state.js",
                "tool-adapters.js",
                "local-recovery.js",
            ]
        )
    if route == "workspace":
        files.update(
            "src/tools/" + name
            for name in [
                "private-workspace.js",
                "record-workspace.js",
                "record-store.js",
                "flashcard-store.js",
                "flashcard-workspace.js",
            ]
        )
    if route == "profile":
        files.add("src/tools/profile.js")
    if route == "games" or route.startswith("games/"):
        files.add(
            "src/games/pong.js" if route == "games/pong" else "src/games/games.js"
        )
    if route.startswith("tools/"):
        advanced = "src/tools/advanced-" + route.split("/")[-1] + ".js"
        if (ROOT / advanced).is_file():
            files.add(advanced)
    pending = list(files)
    while pending:
        name = pending.pop()
        file = ROOT / name
        if not file.is_file():
            continue
        for target in re.findall(
            r"(?:from\s*|import\s*\()\s*[\'\"]([^\'\"]+)",
            file.read_text(encoding="utf-8"),
        ):
            if name == "src/app.js":
                continue
            if target.startswith("/tool-scripts/"):
                resolved = "src/tools/" + target.split("/tool-scripts/", 1)[1]
            elif target.startswith("/game-scripts/"):
                resolved = "src/games/" + target.split("/game-scripts/", 1)[1]
            elif target.startswith("."):
                try:
                    resolved = (
                        (file.parent / target).resolve().relative_to(ROOT).as_posix()
                    )
                except ValueError:
                    continue
            else:
                continue
            if resolved not in files:
                files.add(resolved)
                pending.append(resolved)
    return files


def write_page(route, locale, raw, output, site_url, routes):
    parser = Annotator(locale)
    parser.feed(raw)
    body = parser.output()
    if locale == "zh-Hant":
        body = re.sub(
            r'href="(/[^"#?]*)([?#][^"]*)?"',
            lambda match: (
                'href="'
                + page_path(match[1].strip("/"), locale)
                + (match[2] or "")
                + '"'
                if match[1] in routes and not match[1].startswith("/auth/")
                else match[0]
            ),
            body,
        )
    sources = source_files(route)
    keys = parser.keys | {
        key
        for key, files in USAGE.items()
        if any(source in sources for source in files)
    }
    owned_source = "\n".join(
        (ROOT / name).read_text(encoding="utf-8")
        for name in sources
        if (ROOT / name).is_file()
    )
    keys |= {
        key
        for key, value in CATALOG.items()
        if value["en"] in owned_source
        or json.dumps(value["en"], ensure_ascii=False) in owned_source
    }
    # Shared shell messages are available before auth or page-specific scripts.
    keys |= {key for key, value in CATALOG.items() if key.startswith("site.")}
    keys |= {
        key_for(value["en"])
        for key, value in CATALOG.items()
        if key.startswith("site.")
    }
    keys = {key for key in keys if key in CATALOG}
    english = {key: ENGLISH[key] for key in sorted(keys)}
    chinese = {key: CATALOG[key]["zh-Hant"] for key in sorted(keys)}
    slug = route.replace("/", "-") or "home"
    package = json.dumps(chinese, ensure_ascii=False, separators=(",", ":"))
    digest = hashlib.sha256(package.encode()).hexdigest()[:12]
    relative = "assets/locales/zh-hant-" + slug + "." + digest + ".json"
    target = output / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(package, encoding="utf-8")
    meta = {lang: metadata(route, lang, site_url) for lang in LOCALES}
    initial = {
        "locale": locale,
        "english": english,
        "messages": chinese if locale == "zh-Hant" else {},
        "packs": {"zh-Hant": "/" + relative},
        "route": route,
        "routes": routes,
        "meta": meta,
    }
    encoded = (
        json.dumps(initial, ensure_ascii=False, separators=(",", ":"))
        .replace("<", r"\u003c")
        .replace(">", r"\u003e")
        .replace("&", r"\u0026")
    )
    body = body.replace(
        "</head>",
        '<script id="site-locale-data" type="application/json">'
        + encoded
        + "</script>\n</head>",
    )

    # Enrich only public catalog cards; record titles and user input are never searched.
    def search_card(match):
        opening = match.group(0)
        found = re.search(r'data-(tool-slug|game-theme)="([^"]+)"', opening)
        if not found:
            return opening
        route = ("tools/" if found[1] == "tool-slug" else "games/") + found[2]
        item = CONTENT.get(route)
        if not item:
            return opening
        aliases = " ".join(
            [*item["name"].values(), *item["description"].values(), *item["aliases"]]
        ).lower()
        return re.sub(
            r'data-search="[^"]*"',
            'data-search="' + escape(aliases, quote=True) + '"',
            opening,
        )

    body = re.sub(r"<article\b[^>]*data-(?:tool|game)-card[^>]*>", search_card, body)
    return body


def head(route, locale, site_url):
    meta = metadata(route, locale, site_url)
    lines = [
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        "<title>" + escape(meta["title"]) + "</title>",
        '<meta name="description" content="'
        + escape(meta["description"], quote=True)
        + '">',
        '<meta name="theme-color" content="#111015">',
    ]
    if is_public(route):
        lines += ['<link rel="canonical" href="' + meta["url"] + '">']
        for code in ["en", "zh-Hant", "x-default"]:
            lines.append(
                '<link rel="alternate" hreflang="'
                + code
                + '" href="'
                + site_url
                + page_path(route, "en" if code == "x-default" else code)
                + '">'
            )
        for prop, value in [
            ("og:type", "website"),
            ("og:site_name", "KenSei Workshop"),
            ("og:title", meta["title"]),
            ("og:description", meta["description"]),
            ("og:url", meta["url"]),
            ("og:image", meta["image"]),
            ("og:image:width", "1200"),
            ("og:image:height", "630"),
        ]:
            lines.append(
                '<meta property="'
                + prop
                + '" content="'
                + escape(value, quote=True)
                + '">'
            )
        for prop, value in [
            ("twitter:card", "summary_large_image"),
            ("twitter:title", meta["title"]),
            ("twitter:description", meta["description"]),
            ("twitter:image", meta["image"]),
        ]:
            lines.append(
                '<meta name="' + prop + '" content="' + escape(value, quote=True) + '">'
            )
    else:
        lines.append('<meta name="robots" content="noindex, follow">')
    lines += [
        '<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">',
        '<link rel="stylesheet" href="/assets/fonts/fonts.css">',
    ]
    fonts = json.loads(
        (SOURCE / "assets/fonts/manifest.json").read_text(encoding="utf-8")
    )
    for item in fonts.get("preload", []):
        url = item if isinstance(item, str) else item.get("url", item.get("path"))
        if url:
            lines.append(
                '<link rel="preload" href="'
                + url
                + '" as="font" type="font/woff2" crossorigin>'
            )
    lines.extend(
        '<link rel="stylesheet" href="/' + name + '">' for name in styles(route)
    )
    lines += [
        '<script src="/site/i18n.js" defer></script>',
        '<script src="/site/shell.js" defer></script>',
        '<script src="/config.js" defer></script>',
        '<script src="/tools-data.js" defer></script>',
        '<script src="/app.js" defer></script>',
    ]
    return "\n".join(lines)

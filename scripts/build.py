"""Build only this independent project's dist directory."""

from pathlib import Path
import json
import shutil
import sys
import argparse
import xml.etree.ElementTree as ET

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src"
SITE = json.loads((ROOT / "data/site.json").read_text(encoding="utf-8"))
sys.dont_write_bytecode = True
sys.path.insert(0, str(SOURCE / "views"))
from template_renderer import render_template
from icons import icon
from tool_previews import tool_preview
from studio_view import view as studio_view, copy_update_feed
import localization as i18n
from tool_experience import heading as tool_heading
from profile_view import PROFILE_VIEW
from file_tools import VIEWS
from interactive_tools import VIEWS as INTERACTIVE_VIEWS, history
from daily_tools import VIEWS as DAILY_VIEWS
from media_data_tools import VIEWS as MEDIA_DATA_VIEWS
from study_file_tools import VIEWS as STUDY_FILE_VIEWS, WORKSPACE as FLASHCARD_WORKSPACE
from image_editor import EDITOR, PANEL
from planner_view import VIEW as PLANNER_VIEW
from whiteboard_view import VIEW as WHITEBOARD_VIEW
from capture_views import SCREEN_VIEW, augment_qr, augment_audio
from workspace_sections import WORKSPACE as PLANNER_WORKSPACE
from games_view import (
    achievements,
    directory as game_directory,
    game_page,
    leaderboards,
)
from home_view import view as home_view

# 后面的工具视图优先，保持既有的目录合并顺序。
for views in (INTERACTIVE_VIEWS, DAILY_VIEWS, MEDIA_DATA_VIEWS, STUDY_FILE_VIEWS):
    VIEWS.update(views)
VIEWS.update(
    {
        "study-planner": PLANNER_VIEW,
        "whiteboard": WHITEBOARD_VIEW,
        "screen-recorder": SCREEN_VIEW,
    }
)
VIEWS["qr-studio"] = augment_qr(VIEWS["qr-studio"])
VIEWS["audio-studio"] = augment_audio(VIEWS["audio-studio"])

parser = argparse.ArgumentParser(description="Build the KenSei Workshop static site.")
parser.add_argument(
    "--output",
    type=Path,
    default=ROOT / "dist",
    help="Output directory (default: dist).",
)
parser.add_argument(
    "--pages-only",
    action="store_true",
    help="Rebuild page metadata and locale packs without copying unchanged static assets (development only).",
)
arguments = parser.parse_args()
OUT = arguments.output.resolve()
OUT.mkdir(parents=True, exist_ok=True)
if not arguments.pages_only:
    # Discord 網域驗證需在每次部署後仍可由固定網址讀取純文字。
    shutil.copytree(SOURCE / ".well-known", OUT / ".well-known", dirs_exist_ok=True)
    for name in ("app.js", "config.js"):
        shutil.copy2(SOURCE / name, OUT / name)
    for path in (SOURCE / "styles").glob("*.css"):
        shutil.copy2(path, OUT / path.name)
    shutil.copytree(SOURCE / "assets", OUT / "assets", dirs_exist_ok=True)
    shutil.copy2(
        ROOT / "data/typing-sentences.json", OUT / "assets/typing-sentences.json"
    )

    # 源码归类不改变公开资源网址，现有链接和浏览器存档继续可用。
    for source, public in (
        ("tools", "tool-scripts"),
        ("games", "game-scripts"),
        ("vendor", "vendor"),
        ("site", "site"),
    ):
        shutil.copytree(
            SOURCE / source,
            OUT / public,
            dirs_exist_ok=True,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.tar.gz"),
        )
    # GPL 引擎的固定版本對應原始碼必須隨本站提供。
    for name in [
        "stockfish-js-19.0.1-source.tar.gz",
        "fairy-stockfish-1.1.12-source.tar.gz",
    ]:
        archive = SOURCE / "vendor/sources" / name
        if not archive.is_file():
            raise FileNotFoundError(
                "Corresponding engine source archive is required: " + name
            )
        (OUT / "vendor/sources").mkdir(parents=True, exist_ok=True)
        shutil.copy2(archive, OUT / "vendor/sources" / archive.name)

TOOLS = json.loads((ROOT / "data/tools.json").read_text(encoding="utf-8"))
GAMES = json.loads((ROOT / "data/games.json").read_text(encoding="utf-8"))
HOME_FEATURED = json.loads(
    (ROOT / "data/home-featured.json").read_text(encoding="utf-8")
)
(OUT / "tools-data.js").write_text(
    "window.KENSEI_TOOLS="
    + json.dumps(
        {t[0]: {"name": t[2], "description": t[4], "category": t[5]} for t in TOOLS},
        ensure_ascii=False,
    )
    + ";",
    encoding="utf-8",
)


PROJECTS = [
    (
        "kensei-studio",
        "KenSei Studio",
        "Turn sound into light.",
        "A local music and lightsaber show editor for ESP32-C3 stage props.",
        "Software",
        "Electron / React / ESPHome",
    ),
    (
        "3a3d",
        "3A3D",
        "Automotive, thoughtfully explored.",
        "An automotive showcase built around car culture, visual discovery and detailed specifications.",
        "Web",
        "HTML / CSS / JavaScript",
    ),
    (
        "salon-system",
        "Salon Management System",
        "Structure behind the service.",
        "A C++ coursework project exploring how software can support salon operations.",
        "Software",
        "C++ / Console application",
    ),
    (
        "ai-art",
        "AI Art Gallery",
        "An exploration in imagination.",
        "A collection of visual experiments with local AI and image generation.",
        "Creative",
        "Local AI / Digital art",
    ),
]


def project_art(slug):
    if slug == "kensei-studio":
        return '<div class="studio-card-cover"><img src="/assets/kensei-studio/preview.png" loading="lazy" decoding="async" alt="KenSei Studio show editor and LED preview" width="1560" height="1000"></div>'
    if slug == "3a3d":
        return render_template("projects/art-3a3d.html")
    if slug == "salon-system":
        return render_template("projects/art-salon.html")
    return render_template("projects/art-ai.html")


def project_card(p, featured=False):
    slug, name, title, desc, cat, stack = p
    return render_template(
        "projects/card.html",
        content="featured" if featured else "",
        lower=cat.lower(),
        slug=slug,
        name=name,
        project_art=project_art(slug),
        cat=cat,
        desc=desc,
        stack=stack,
    )


def tool_card(t, illustrated=False):
    slug, glyph, name, title, desc, cat = t
    return render_template(
        "site/tool-card.html",
        lower=name.lower(),
        lower_2=desc.lower(),
        lower_3=cat.lower(),
        lower_4=cat.lower(),
        glyph=glyph,
        icon=icon(glyph),
        slug=slug,
        name=name,
        icon_star=icon("star"),
        illustration=tool_preview(slug) if illustrated else "",
        slug_2=slug,
        name_2=name,
        desc=desc,
        cat=cat,
        slug_3=slug,
        icon_arrow=icon("arrow"),
    )


def header(active):
    nav = "".join(
        '<a href="'
        + url
        + '"'
        + (' aria-current="page"' if active == label else "")
        + ">"
        + label
        + "</a>"
        for label, url in [
            ("Home", "/"),
            ("Tools", "/tools/"),
            ("Games", "/games/"),
            ("Projects", "/projects/"),
        ]
    )
    return render_template(
        "site/header.html",
        nav=nav,
        sun=icon("sun", "data-theme-sun"),
        moon=icon("moon", "data-theme-moon hidden"),
    )


def layout(title, content, active="Home", route="", locale="en"):
    return render_template(
        "site/layout.html",
        google_site_verification=SITE["google_site_verification"],
        locale=locale,
        head_html=i18n.head(route, locale, SITE["site_url"].rstrip("/")),
        header=header(active),
        content=content,
    )


def tool_directory(illustrated=False):
    return render_template(
        "site/tool-directory.html",
        tool_cards="".join(tool_card(t, illustrated) for t in TOOLS),
    )


def page_intro(label, title, desc):
    return f'<div class="page-intro"><div class="eyebrow">{label}</div><h1>{title}<span class="accent">.</span></h1><p>{desc}</p></div>'


pages = {
    "": (
        "KenSei Workshop",
        home_view(TOOLS, GAMES, PROJECTS, project_art, HOME_FEATURED),
        "Home",
    )
}
pages["projects"] = (
    "Projects",
    render_template(
        "pages/projects.html",
        intro=page_intro(
            "THE PROJECT SHELF",
            "Ideas, made tangible",
            "Websites, software and creative experiments. Each one starts with a little curiosity.",
        ),
        project_cards="".join((project_card(p) for p in PROJECTS)),
    ),
    "Projects",
)
pages["tools"] = (
    "Tools",
    f'<section class="container page-section tools-page">{page_intro("THE EVERYDAY TOOLBOX", "A little help goes a long way", "Everyday tools for files, words, colors, connections and focus. Local tools need no sign-up.")}{tool_directory(illustrated=True)}</section>',
    "Tools",
)

image_ui = render_template("tools/image-studio/batch.html")
text_ui = render_template("tools/text-toolkit.html")
timer_ui = render_template("tools/focus-timer.html")


image_ui += f'<button id="cancel-job" class="button secondary" hidden>Cancel</button><button id="image-zip" class="button secondary" hidden>Download all as ZIP {icon("download")}</button><div id="batch-results" class="batch-results" aria-live="polite"></div>'
image_ui = EDITOR + '<div id="image-batch-mode">' + image_ui + "</div>" + PANEL

interfaces = {
    "image-studio": image_ui,
    "text-toolkit": text_ui,
    "focus-timer": timer_ui,
    **VIEWS,
}
for t in TOOLS:
    ui = interfaces[t[0]]
    slug, glyph, name, title, desc, cat = t
    pages["tools/" + slug] = (
        name,
        f'<section class="container page-section tool-page" data-tool="{slug}">{tool_heading(t, icon("star"))}{ui}</section>',
        "Tools",
    )

details = {
    "3a3d": (
        "An independent automotive showcase",
        (
            "3A3D brings automotive browsing into a visual, editorial experience. "
            "The project combines a shared design system with a structured vehicle "
            "catalog."
        ),
        [
            "Vehicle and brand discovery",
            "Search, filtering and sorting",
            "Reusable templates and catalog data",
        ],
        "HTML, CSS, JavaScript and a Python static-page generator.",
        "https://kenseiisme.github.io/3A3D/",
        "Launch website",
        "Car imagery from the existing project. This cover is a graphic composition, not a screenshot.",
    ),
    "salon-system": (
        "A software coursework project",
        (
            "An exploration of C++ and system design through a salon management "
            "application. The repository is the source of truth for implementation "
            "details."
        ),
        [
            "Console application structure",
            "Salon operations as a software domain",
            "Coursework source available on GitHub",
        ],
        "C++. Explore the source for implementation and assignment context.",
        "https://github.com/KenSeiisme/Programming-Assignment",
        "View source code",
        "Illustrative cover. The code graphic is not a screenshot of the application.",
    ),
    "ai-art": (
        "Experiments in local AI",
        (
            "A space for exploring image generation, composition and visual "
            "direction. The artwork collection lives on Pixiv as a separate "
            "creative destination."
        ),
        [
            "Image-generation experiments",
            "Creative direction and composition",
            "An external artwork collection",
        ],
        "Local AI and digital image creation.",
        "https://www.pixiv.net/users/43759201/artworks",
        "View on Pixiv",
        "Abstract graphic cover. Browse Pixiv to see the actual artworks.",
    ),
}
for p in PROJECTS:
    slug, name, title, desc, cat, stack = p
    if slug == "kensei-studio":
        pages["projects/" + slug] = (name, studio_view(), "Projects")
        continue
    subtitle, overview, highlights, tech, url, cta, note = details[slug]
    pages["projects/" + slug] = (
        name,
        render_template(
            "pages/project-detail.html",
            category=cat,
            name=name,
            subtitle=subtitle,
            car_attribute="data-car" if slug == "3a3d" else "",
            url=url,
            cta=cta,
            project_art=project_art(slug),
            note=note,
            overview=overview,
            highlights="".join(("<li>" + x + "</li>" for x in highlights)),
            tech=tech,
        ),
        "Projects",
    )

pages["workspace"] = (
    "Your workspace",
    render_template(
        "pages/workspace.html",
        intro=page_intro(
            "YOUR OWN LITTLE CORNER",
            "Pick up where you left off",
            "Your favorites, saved words and moments of focus.",
        ),
        answer_history=history("answer", "Answer Book history", "workspace-answers"),
        decision_history=history("decision", "Decision schemes", "workspace-decisions"),
        flashcards=FLASHCARD_WORKSPACE,
        planner_and_whiteboards=PLANNER_WORKSPACE,
    ),
    "Workspace",
)
pages["profile"] = ("Profile", PROFILE_VIEW, "Workspace")
pages["auth/callback"] = (
    "Signing in",
    render_template("pages/auth-callback.html"),
    "Workspace",
)
pages["privacy"] = ("Privacy", render_template("pages/privacy.html"), "Privacy")
pages["404"] = ("Page not found", render_template("pages/404.html"), "Home")
credits = json.loads((SOURCE / "vendor/credits.json").read_text(encoding="utf-8"))
credit_list = "".join(
    f'<li><strong>{x["name"]} {x["version"]}</strong> · {x["license"]} · <a href="/vendor/licenses/{x["name"]}.txt">License</a></li>'
    for x in credits
)
pages["credits"] = (
    "Open-source credits",
    render_template("pages/credits.html", credit_list=credit_list),
    "Tools",
)

pages["games"] = ("Games", game_directory(GAMES), "Games")
pages["games/leaderboards"] = ("All leaderboards", leaderboards(GAMES), "Games")
pages["games/achievements"] = ("Achievements", achievements(), "Games")
for game in GAMES:
    pages["games/" + game["slug"]] = (game["name"], game_page(game), "Games")


copy_update_feed(OUT)
site_url = SITE["site_url"].rstrip("/")
routes = [i18n.page_path(route) for route in pages]
social = []
for route, (title, body, active) in pages.items():
    for locale in i18n.LOCALES:
        relative = i18n.page_path(route, locale).strip("/")
        target = OUT / relative / "index.html"
        target.parent.mkdir(parents=True, exist_ok=True)
        raw = layout(title, body, active, route, locale)
        target.write_text(
            i18n.write_page(route, locale, raw, OUT, site_url, routes), encoding="utf-8"
        )
        if i18n.is_public(route):
            meta = i18n.metadata(route, locale, site_url)
            social.append(
                {
                    "route": route,
                    "locale": locale,
                    "title": meta["title"].split(" — ")[0],
                    "description": meta["description"],
                    "type": route.split("/")[0] or "home",
                }
            )
(OUT / "404.html").write_text(
    (OUT / "404/index.html").read_text(encoding="utf-8"), encoding="utf-8"
)
(OUT / "social-manifest.json").write_text(
    json.dumps(social, ensure_ascii=False, indent=2), encoding="utf-8"
)
search = [
    {
        "route": "/" + route + "/",
        "type": route.split("/")[0],
        "aliases": [],
        **entry,
    }
    for route, entry in i18n.CONTENT.items()
]
(OUT / "assets/search-index.json").write_text(
    json.dumps(search, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
)
sitemap_namespace = "http://www.sitemaps.org/schemas/sitemap/0.9"
ET.register_namespace("", sitemap_namespace)
sitemap = ET.Element(f"{{{sitemap_namespace}}}urlset")
for route in pages:
    if not i18n.is_public(route):
        continue
    for locale in i18n.LOCALES:
        entry = ET.SubElement(sitemap, f"{{{sitemap_namespace}}}url")
        ET.SubElement(entry, f"{{{sitemap_namespace}}}loc").text = (
            site_url + i18n.page_path(route, locale)
        )
ET.indent(sitemap, space="  ")
ET.ElementTree(sitemap).write(
    OUT / "sitemap.xml", encoding="utf-8", xml_declaration=True
)
(OUT / "robots.txt").write_text(
    "User-agent: *\nAllow: /\n\nSitemap: " + site_url + "/sitemap.xml\n",
    encoding="utf-8",
)
print(f"Built {len(pages)*2} localized pages in {OUT}")

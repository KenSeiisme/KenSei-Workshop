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

ICONS = {
    "cards": '<rect x="5" y="4" width="16" height="17" rx="2"/><path d="M2 17V2h15M9 9h8M9 14h6"/>',
    "calculator": '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M7 6h10M7 11h2M13 11h4M7 16h2M13 16h4"/>',
    "check": '<path d="M6 2h8l4 4v16H6zM9 13l2 2 4-5"/>',
    "audio": '<path d="M3 10v4M7 6v12M11 3v18M15 7v10M19 10v4"/>',
    "data": '<path d="M8 3H5v7l-3 2 3 2v7h3M16 3h3v7l3 2-3 2v7h-3M10 9h4M10 15h4"/>',
    "network": '<path d="M2 8a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8 16a5 5 0 0 1 8 0"/><circle cx="12" cy="20" r="1"/>',
    "archive": '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M10 3h4v3h-4v3h4v3h-4v5h4v-3h-4"/>',
    "palette": '<circle cx="8" cy="8" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="18" cy="12" r="1"/><path d="M12 22C0 22 0 2 12 2s13 13 4 13h-3c-5 0 5 7-1 7Z"/>',
    "ruler": '<path d="m3 16 13-13 5 5L8 21zM7 12l3 3M11 8l3 3M15 4l3 3"/>',
    "key": '<circle cx="8" cy="8" r="5"/><path d="m12 12 9 9M16 16l3-3M19 19l3-3"/>',
    "image": '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
    "text": '<path d="M4 5h16M12 5v15M8 20h8M4 5v3M20 5v3"/>',
    "timer": '<circle cx="12" cy="13" r="8"/><path d="M12 9v5l3 2M9 2h6M12 2v3m6 2 2-2"/>',
    "arrow": '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    "star": '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
    "book": '<path d="M12 5v16M12 5C8 2 4 3 2 4v15c4-2 7-1 10 2 3-3 6-4 10-2V4c-4-2-7-1-10 1Z"/>',
    "wheel": '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M6 6l12 12M18 6 6 18"/>',
    "keyboard": '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M5 9h2m3 0h2m3 0h3M5 13h2m3 0h2m3 0h3M7 16h10"/>',
    "monitor": '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4M7 21h10"/>',
    "grid": '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
}


def icon(name):
    return f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICONS[name]}</svg>'


TOOLS = json.loads((ROOT / "data/tools.json").read_text(encoding="utf-8"))
(OUT / "tools-data.js").write_text(
    "window.KENSEI_TOOLS="
    + json.dumps(
        {t[0]: {"name": t[2], "description": t[4], "category": t[5]} for t in TOOLS},
        ensure_ascii=False,
    )
    + ";",
    encoding="utf-8",
)
for glyph, path in {
    "qr": '<path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h2v2h-2zM19 19h2v2h-2zM19 13h2v3M13 19v2"/>',
    "pdf": '<path d="M6 2h8l4 4v16H6zM14 2v5h4M9 12h6M9 16h6"/>',
    "markdown": '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M5 15V9l3 3 3-3v6M14 12l3 3 3-3M17 9v6"/>',
    "compare": '<path d="M8 3v18M16 3v18M3 7h8M13 17h8M3 11h4M17 13h4"/>',
    "ocr": '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5M7 8h10M12 8v9M9 17h6"/>',
}.items():
    ICONS[glyph] = path

PROJECTS = [
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


def project_art(slug, large=False):
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
        slug_2=slug,
        name_2=name,
        desc=desc,
        stack=stack,
    )


def tool_card(t):
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
    return render_template("site/header.html", nav=nav)


def layout(title, content, active="Home", route="", locale="en"):
    return render_template(
        "site/layout.html",
        google_site_verification=SITE["google_site_verification"],
        locale=locale,
        head_html=i18n.head(route, locale, SITE["site_url"].rstrip("/")),
        header=header(active),
        content=content,
    )


def tool_directory():
    # 首页与目录共用工具数据和交互标记。
    return render_template(
        "site/tool-directory.html", tool_cards="".join((tool_card(t) for t in TOOLS))
    )


home = render_template(
    "pages/home.html",
    icon_arrow=icon("arrow"),
    icon_grid=icon("grid"),
    icon_text=icon("text"),
    tool_directory=tool_directory(),
)


def page_intro(label, title, desc):
    return f'<div class="page-intro"><div class="eyebrow">{label}</div><h1>{title}<span class="accent">.</span></h1><p>{desc}</p></div>'


pages = {"": ("Useful tools for everyday things", home, "Home")}
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
    f'<section class="container page-section">{page_intro("THE EVERYDAY TOOLBOX", "A little help goes a long way", "Everyday tools for files, words, colors, connections and focus. Local tools need no sign-up.")}{tool_directory()}</section>',
    "Tools",
)

image_ui = render_template("tools/image-studio/batch.html")
text_ui = render_template("tools/text-toolkit.html")
timer_ui = render_template("tools/focus-timer.html")


image_ui += '<button id="cancel-job" class="button secondary" hidden>Cancel</button><button id="image-zip" class="button secondary" hidden>Download all as ZIP ↓</button><div id="batch-results" class="batch-results" aria-live="polite"></div>'
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
        "https://3a3d.vercel.app/",
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
    subtitle, overview, highlights, tech, url, cta, note = details[slug]
    pages["projects/" + slug] = (
        name,
        render_template(
            "pages/project-detail.html",
            category=cat.upper(),
            name=name,
            subtitle=subtitle,
            car_attribute="data-car" if slug == "3a3d" else "",
            url=url,
            cta=cta,
            project_art=project_art(slug, True),
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

from games_view import directory as game_directory, game_page

GAMES = json.loads((ROOT / "data/games.json").read_text(encoding="utf-8"))
pages["games"] = ("Games", game_directory(GAMES), "Games")
for game in GAMES:
    pages["games/" + game["slug"]] = (game["name"], game_page(game), "Games")


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
    {"route": "/" + route + "/", "type": route.split("/")[0], **entry}
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

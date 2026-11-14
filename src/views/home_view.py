"""Homepage entry cards built from the public catalogs."""

from html import escape

from games_view import play_tags, preview
from icons import icon
from template_renderer import render_template
from tool_previews import tool_preview


FLOATING_ART = {
    "intro": (
        ("tools", "image"),
        ("games", "chess"),
        ("projects", "audio"),
        ("tools", "ring"),
        ("games", "diamond"),
        ("projects", "spark"),
        ("tools", "timer"),
        ("games", "ring"),
        ("projects", "diamond"),
        ("tools", "palette"),
    ),
    "tools": (("tools", "tool-preview"), ("tools", "diamond")),
    "games": (("games", "game-preview"), ("games", "ring")),
    "projects": (("projects", "project-preview"), ("projects", "spark")),
}

FLOATING_PREVIEWS = {
    "tools": {
        slug: tool_preview(slug)
        for slug in (
            "color-studio",
            "audio-studio",
            "decision-studio",
            "data-studio",
            "study-planner",
        )
    },
    "games": {
        slug: preview(kind)
        for slug, kind in (
            ("nonogram", "nonogram"),
            ("reversi", "reversi"),
            ("memory-match", "memory"),
            ("block-drop", "block-drop"),
            ("go", "go"),
        )
    },
}


def atmosphere(scene, featured=()):
    previews = {
        slug: f'<div class="home-bubble-art" data-float-slug="{slug}">{markup}</div>'
        for slug, markup in FLOATING_PREVIEWS.get(scene, {}).items()
    }
    selected = next((slug for slug in previews if slug not in featured), None)
    art = {
        "chess": '<img src="/assets/chess/wn.svg" alt="" width="32" height="32">',
        "project-preview": '<img src="/assets/mazda.png" alt="" loading="lazy" width="800" height="450">',
        "ring": "",
        "diamond": "",
        "spark": "✦",
    }
    if selected:
        art["tool-preview" if scene == "tools" else "game-preview"] = previews[selected]
    alternates = (
        '<template data-home-float-alternates>'
        + "".join(markup for slug, markup in previews.items() if slug != selected)
        + "</template>"
        if selected
        else ""
    )
    bubbles = "".join(
        f'<div class="home-bubble-anchor" data-home-section="{kind}" data-float-art="{glyph}">'
        f'<div class="home-bubble">{art[glyph] if glyph in art else icon(glyph)}</div></div>'
        for kind, glyph in FLOATING_ART[scene]
    )
    return (
        '<div class="home-atmosphere" aria-hidden="true">'
        f'<div class="home-bubbles">{bubbles}</div>'
        f'<div class="home-particles"></div>{alternates}</div>'
    )


def home_card(kind, slug, name, description, art, accent, tags):
    return render_template(
        "site/home-card.html",
        slug=slug,
        accent=accent,
        url=f"/{kind}/{slug}/",
        name=escape(name),
        description=escape(description),
        art=art,
        tags=f'<div class="home-card-tags">{tags}</div>',
    )


def home_section(kind, anchor, name, catalog, links, featured=None):
    visible = list(catalog) if featured is None else featured
    if len(visible) != 4 or len(set(visible)) != len(visible):
        raise ValueError(f"Expected four distinct homepage {kind} cards")
    rest = "".join(card for slug, card in catalog.items() if slug not in visible)
    source = (
        '<p class="home-list-source"><span data-home-featured>Featured</span>'
        '<span data-home-popular hidden>Most viewed in the past 30 days</span></p>'
        if featured is not None
        else '<p>Four projects from the Workshop.</p>'
    )
    actions = "".join(
        f'<a class="text-link" href="{url}"><span>{label}</span> {icon(glyph)}</a>'
        for url, label, glyph in links
    )
    return render_template(
        "site/home-section.html",
        kind=kind,
        anchor=anchor,
        atmosphere=atmosphere(kind, visible),
        name=name,
        source=source,
        actions=actions,
        cards="".join(catalog[slug] for slug in visible),
        alternates=f"<template data-home-card-alternates>{rest}</template>"
        if rest
        else "",
    )


def view(tools, games, projects, project_art, featured):
    sections = [
        home_section(
            "tools",
            "toolbox",
            "Tools",
            {
                slug: home_card(
                    "tools",
                    slug,
                    name,
                    description,
                    tool_preview(slug),
                    f'data-category="{category.lower()}"',
                    f"<span>{category}</span>",
                )
                for slug, _, name, _, description, category in tools
            },
            [("/tools/", "All tools", "arrow")],
            featured["tools"],
        ),
        home_section(
            "games",
            "games",
            "Games",
            {
                game["slug"]: home_card(
                    "games",
                    game["slug"],
                    game["name"],
                    game["description"],
                    f'<div class="game-cover" aria-hidden="true">{preview(game["preview"])}</div>',
                    f'data-game-theme="{game["slug"]}"',
                    play_tags(game),
                )
                for game in games
            },
            [
                ("/games/leaderboards/", "Leaderboards", "rank"),
                ("/games/", "All games", "arrow"),
            ],
            featured["games"],
        ),
        home_section(
            "projects",
            "projects",
            "Projects",
            {
                slug: home_card(
                    "projects",
                    slug,
                    name,
                    description,
                    project_art(slug),
                    f'data-project="{slug}"',
                    f"<span>{category}</span>",
                )
                for slug, name, _, description, category, _ in projects
            },
            [("/projects/", "All projects", "arrow")],
        ),
    ]
    return render_template(
        "pages/home.html",
        atmosphere=atmosphere("intro"),
        tool_art=tool_preview("image-studio"),
        game_art=preview("2048"),
        sections="".join(sections),
    )

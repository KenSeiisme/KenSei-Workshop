"""Homepage entry cards built from the public catalogs."""

from html import escape

from games_view import play_tags, preview
from icons import icon
from template_renderer import render_template
from tool_previews import tool_preview


BUBBLE_ART = {
    "intro": (
        ("tools", "image"),
        ("games", "chess"),
        ("projects", "audio"),
        ("tools", "timer"),
        ("games", "grid"),
        ("projects", "cards"),
    ),
    "tools": (("tools", "timer"),),
    "games": (("games", "chess"),),
    "projects": (("projects", "audio"),),
}


def atmosphere(scene):
    bubbles = "".join(
        f'<span class="home-bubble-anchor" data-home-section="{kind}"><span class="home-bubble">'
        + (
            '<img src="/assets/chess/wn.svg" alt="" width="32" height="32">'
            if glyph == "chess"
            else icon(glyph)
        )
        + "</span></span>"
        for kind, glyph in BUBBLE_ART[scene]
    )
    return (
        '<div class="home-atmosphere" aria-hidden="true">'
        f'<div class="home-bubbles">{bubbles}</div>'
        '<div class="home-particles"></div></div>'
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
        atmosphere=atmosphere(kind),
        name=name,
        source=source,
        actions=actions,
        cards="".join(catalog[slug] for slug in visible),
        alternates=f"<template>{rest}</template>" if rest else "",
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

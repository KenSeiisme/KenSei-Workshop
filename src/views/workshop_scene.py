"""Decorative scenes shared by the three Workshop catalogs and their pages."""

from games_view import preview
from icons import icon
from tool_previews import tool_preview

ROOTS = {"tools", "games", "projects"}
ART = {
    "tools": (("tool", "color-studio"), ("icon", "timer"), ("icon", "pdf"), ("icon", "qr")),
    "games": (("game", "nonogram"), ("chess", ""), ("icon", "grid"), ("icon", "achievement")),
    "projects": (("project", ""), ("gallery", ""), ("icon", "audio"), ("icon", "cards")),
}
SHAPES = (("ring", ""), ("diamond", ""), ("spark", ""), ("orb", ""))


def bubble_art(kind, value):
    if kind == "tool":
        return tool_preview(value, miniature=True)
    if kind == "game":
        return preview(value)
    if kind == "chess":
        return '<img src="/assets/chess/wn.svg" alt="" width="32" height="32">'
    if kind == "project":
        return (
            '<img src="/assets/kensei-studio/preview.png" alt="" width="1560"'
            ' height="1000" loading="lazy" decoding="async">'
        )
    if kind == "gallery":
        return '<span class="workshop-orbs"><i></i><i></i><i></i></span>'
    if kind == "icon":
        return icon(value)
    return "✦" if kind == "spark" else ""


def scene(route):
    section, _, slug = route.partition("/")
    if section not in ROOTS:
        return ""
    ornaments = (
        (*ART[section], *SHAPES)
        if not slug
        else (ART[section][1], ("ring", ""), ("spark", ""))
    )
    bubbles = "".join(
        f'<div class="workshop-bubble-anchor" data-art="{kind}">'
        f'<div class="workshop-bubble">{bubble_art(kind, value)}</div></div>'
        for kind, value in ornaments
    )
    return (
        f'<div class="workshop-atmosphere" data-area="{section}"'
        + (" data-catalog-scene" if not slug else "")
        + f' aria-hidden="true">{bubbles}</div>'
    )

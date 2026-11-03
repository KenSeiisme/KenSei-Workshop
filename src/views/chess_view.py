"""Chess uses authoritative board matches, separate from solo score sessions."""

from template_renderer import render_template

VIEW = render_template(
    "games/chess.html",
    toolbar=render_template(
        "games/play-toolbar.html", name="Chess", sound_id="chess-sound"
    ),
    preferences=render_template("games/play-preferences.html"),
)

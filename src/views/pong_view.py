"""Online Pong has a dedicated transient room lifecycle, never a tool/game save."""

from template_renderer import render_template

VIEW = render_template(
    "games/pong.html",
    toolbar=render_template(
        "games/play-toolbar.html", name="Pong", sound_id="pong-sound"
    ),
    preferences=render_template("games/play-preferences.html"),
)

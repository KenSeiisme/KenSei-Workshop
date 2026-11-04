"""Xiangqi: the WXF rectangular board uses the shared game stage."""

from template_renderer import render_template

VIEW = render_template(
    "games/xiangqi.html",
    toolbar=render_template(
        "games/play-toolbar.html", name="Xiangqi", sound_id="xiangqi-sound"
    ),
    preferences=render_template("games/play-preferences.html"),
)

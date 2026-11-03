"""Go has authoritative turn-based matches, independent of solo ranked sessions."""

from template_renderer import render_template

VIEW = render_template(
    "games/go.html",
    toolbar=render_template("games/play-toolbar.html", name="Go", sound_id="go-sound"),
    preferences=render_template("games/play-preferences.html"),
)

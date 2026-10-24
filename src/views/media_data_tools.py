"""Visual measurement and locally processed daily tools."""

from template_renderer import render_template

VIEWS = {
    "network-test": render_template("tools/network-test.html"),
    "time-studio": render_template("tools/time-studio.html"),
    "file-renamer": render_template("tools/file-renamer.html"),
    "audio-studio": render_template("tools/audio-studio.html"),
    "data-studio": render_template("tools/data-studio.html"),
}

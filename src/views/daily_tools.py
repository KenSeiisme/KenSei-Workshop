"""Daily tools; games will have a separate catalog and route family."""

from template_renderer import render_template

VIEWS = {
    "zip-studio": render_template("tools/zip-studio.html"),
    "color-studio": render_template("tools/color-studio.html"),
    "unit-converter": render_template("tools/unit-converter.html"),
    "password-generator": render_template("tools/password-generator.html"),
}

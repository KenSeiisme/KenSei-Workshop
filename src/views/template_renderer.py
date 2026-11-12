"""Small standard-library renderer for the site's readable HTML templates."""

from collections import ChainMap
from functools import lru_cache
from pathlib import Path
from string import Template

from icons import ICONS, icon

TEMPLATES = Path(__file__).resolve().parents[1] / "templates"
ICON_SLOTS = {f"svg_{name}": icon(name) for name in ICONS}


@lru_cache(maxsize=None)
def _template(name: str) -> Template:
    path = (TEMPLATES / name).resolve()
    if not path.is_relative_to(TEMPLATES):
        raise ValueError("Template paths must stay inside src/templates.")
    return Template(path.read_text(encoding="utf-8"))


def render_template(template_name: str, **values: object) -> str:
    """Substitute view data and shared svg_* slots."""
    return _template(template_name).substitute(ChainMap(values, ICON_SLOTS))

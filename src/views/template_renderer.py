"""Small standard-library renderer for the site's readable HTML templates."""

from functools import lru_cache
from pathlib import Path
from string import Template

TEMPLATES = Path(__file__).resolve().parents[1] / "templates"


@lru_cache(maxsize=None)
def _template(name: str) -> Template:
    path = (TEMPLATES / name).resolve()
    if not path.is_relative_to(TEMPLATES):
        raise ValueError("Template paths must stay inside src/templates.")
    return Template(path.read_text(encoding="utf-8"))


def render_template(template_name: str, **values: object) -> str:
    """Substitute $name slots; callers escape user text before passing it in."""
    return _template(template_name).substitute(values)

"""Format owned Python files with pinned Black, without scanning parent folders."""

from pathlib import Path
import sys

try:
    import black
except ImportError:
    raise SystemExit("Run: python -m pip install -r requirements-dev.txt")

ROOT = Path(__file__).resolve().parents[1]
settings = black.parse_pyproject_toml(str(ROOT / "pyproject.toml"))
if black.__version__ != settings["required_version"]:
    raise SystemExit(
        "Install the pinned formatter: pip install -r requirements-dev.txt"
    )
mode = black.FileMode(
    line_length=settings["line_length"],
    target_versions={
        getattr(black.TargetVersion, v.upper()) for v in settings["target_version"]
    },
)
files = [ROOT / "build.py"]
for folder in ("src/views", "scripts", "tests"):
    files.extend(
        p for p in (ROOT / folder).rglob("*.py") if "__pycache__" not in p.parts
    )
write = "--write" in sys.argv
changed = 0
for path in sorted(files):
    source = path.read_text(encoding="utf-8")
    try:
        formatted = black.format_file_contents(source, fast=False, mode=mode)
    except black.NothingChanged:
        continue
    changed += 1
    if write:
        path.write_text(formatted, encoding="utf-8", newline="\n")
    else:
        print(f"Needs formatting: {path.relative_to(ROOT)}")
print(
    f"{len(files)} Python files checked; {changed} {'formatted' if write else 'need formatting'}."
)
raise SystemExit(0 if write or not changed else 1)

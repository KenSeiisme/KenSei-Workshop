"""Check explicit uiMsg source strings against the built localization catalog."""

import argparse
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / "src" / "views"))
import localization as L

LITERAL = re.compile(r'\buiMsg\s*\(\s*("(?:[^"\\]|\\.)*")')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--list", action="store_true", help="Report gaps without failing."
    )
    args = parser.parse_args()
    missing = set()
    calls = 0
    for file in sorted(L.SOURCE.rglob("*.js")):
        path = file.relative_to(ROOT).as_posix()
        if path.startswith(("src/vendor/", "src/assets/")):
            continue
        source = file.read_text(encoding="utf-8")
        for match in LITERAL.finditer(source):
            message = L.normalized(json.loads(match[1]))
            if message.startswith("is-") or (
                path == "src/site/ui.js" and message == "{0}"
            ):
                continue
            calls += 1
            if L.key_for(message) in L.CATALOG:
                continue
            line = source.count("\n", 0, match.start()) + 1
            missing.add(message)
            print(f"{path}:{line}: {message}")
    print(f"{calls} explicit uiMsg calls checked; {len(missing)} missing messages.")
    return int(bool(missing) and not args.list)


if __name__ == "__main__":
    raise SystemExit(main())

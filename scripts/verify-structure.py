"""Check a clean build without changing the normal dist directory."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


qa = ROOT / "_qa"
qa.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix="structure-", dir=qa) as temporary:
    output = Path(temporary).resolve()
    # 临时清理只允许_qa 下本次创建的专用文件夹。
    assert output.is_relative_to(qa.resolve())
    assert output.name.startswith("structure-")
    subprocess.run([sys.executable, "-X", "utf8", str(ROOT / "build.py"), "--output", str(output)], check=True)
    tools = json.loads((ROOT / "data/tools.json").read_text(encoding="utf-8"))
    assert len({tool[0] for tool in tools}) == len(tools)
    for slug, *_ in tools:
        assert (output / "tools" / slug / "index.html").is_file(), slug
    games = json.loads((ROOT / "data/games.json").read_text(encoding="utf-8"))
    for game in games:
        assert (output / "games" / game["slug"] / "index.html").is_file()
    assert (output / "games/index.html").is_file()
    for name in ("app.js", "config.js"):
        assert digest(SOURCE / name) == digest(output / name), name
    for path in (SOURCE / "styles").glob("*.css"):
        assert digest(path) == digest(output / path.name), path.name
    for source, public in (("assets", "assets"), ("tools", "tool-scripts"), ("games", "game-scripts"), ("vendor", "vendor")):
        for path in (SOURCE / source).rglob("*"):
            if not path.is_file() or "__pycache__" in path.parts or path.name.endswith((".pyc", ".tar.gz")):
                continue
            relative = path.relative_to(SOURCE / source)
            assert digest(path) == digest(output / public / relative), str(relative)
    for forbidden in (".env.local", "src", "scripts", "data", "supabase", "tests", "package.json"):
        assert not (output / forbidden).exists(), forbidden
    assert (output / "auth/callback/index.html").is_file()
    assert (output / "workspace/index.html").is_file()
    assert (output / "profile/index.html").is_file()
    print(f"PASS clean build: {len(tools)} tool routes, unchanged public asset paths, complete vendor assets and no private source files.")

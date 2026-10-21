"""Keep matching package source and build files; omit unrelated media fixtures."""
from pathlib import Path
import io
import tarfile

archive = Path(__file__).resolve().parents[1] / "vendor/sources/mediabunny-1.61.6.tgz"
payload = archive.read_bytes()
with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as upstream:
    members = upstream.getmembers()
    selected = [
        item for item in members
        if len(Path(item.name).parts) <= 2
        or Path(item.name).parts[1] in {"src", "packages", "scripts", "shared"}
    ]
    if len(selected) != len(members):
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode="w:gz") as result:
            for item in selected:
                if item.isfile():
                    result.addfile(item, upstream.extractfile(item))
                elif item.isdir():
                    result.addfile(item)
        archive.write_bytes(output.getvalue())
print("Matching encoder/core source and upstream build files are included.")

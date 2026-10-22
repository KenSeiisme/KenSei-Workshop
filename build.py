"""Compatibility entry point: python build.py still builds the complete site."""
from pathlib import Path
import runpy

if __name__ == "__main__":
    runpy.run_path(str(Path(__file__).resolve().parent / "scripts" / "build.py"), run_name="__main__")

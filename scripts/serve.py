"""Preview built files with consistent ES module / WASM content types on Windows."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import mimetypes
import sys

mimetypes.add_type('application/javascript', '.mjs')
mimetypes.add_type('application/wasm', '.wasm')
handler = partial(SimpleHTTPRequestHandler, directory=str(Path(__file__).resolve().parents[1] / 'dist'))
with ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 8769), handler) as server:
    print(f'Local preview: http://127.0.0.1:{server.server_port}', flush=True)
    server.serve_forever()

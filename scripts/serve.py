"""Preview built files with consistent ES module / WASM content types on Windows."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import mimetypes
import sys

mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("application/wasm", ".wasm")


class PreviewHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        route = self.path.split("?", 1)[0]
        if route.startswith(
            ("/games/xiangqi/", "/zh-hant/games/xiangqi/", "/vendor/fairy-stockfish/")
        ):
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        super().end_headers()

    def log_message(self, format, *args):
        if "--quiet" not in sys.argv:
            super().log_message(format, *args)


class PreviewServer(ThreadingHTTPServer):
    # 同時載入多個 ES module／多瀏覽器驗收時，避免預設 5 個連線的佇列拒絕請求。
    request_queue_size = 128
    daemon_threads = True


handler = partial(
    PreviewHandler,
    directory=str(Path(__file__).resolve().parents[1] / "dist"),
)
with PreviewServer(
    ("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 8769), handler
) as server:
    print(f"Local preview: http://127.0.0.1:{server.server_port}", flush=True)
    server.serve_forever()

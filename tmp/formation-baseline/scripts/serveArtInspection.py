"""Serve editable art inspection pages locally without stale browser caches."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class ArtInspectionHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    art_root = Path(__file__).resolve().parent.parent / "Art"
    handler = partial(ArtInspectionHandler, directory=str(art_root))
    with ThreadingHTTPServer(("127.0.0.1", 9007), handler) as server:
        server.serve_forever()

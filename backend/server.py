#!/usr/bin/env python3
"""Docket (home) server: serves dist/ and every /api/* route. Replaces server/proxy.cjs.

Stdlib only by design, same shape as the work Docket's backend/server.py.

    python3 backend/server.py [--port 3010]
"""

import argparse
import json
import mimetypes
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))

from homeapi import graph, mirror, routes, search  # noqa: E402
from homeapi.common import REPO, request, setting  # noqa: E402

DIST = REPO / "dist"


class Handler(BaseHTTPRequestHandler):
    server_version = "docket-home"

    def log_message(self, fmt, *args):
        path = getattr(self, "path", None)
        if path is None or (path.startswith("/api/") and self.command != "GET"):
            super().log_message(fmt, *args)

    # ── helpers ───────────────────────────────────────────────────────────────

    def _send(self, status, body, ctype):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        if ctype.startswith("application/json"):
            self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_json(self, payload, status=HTTPStatus.OK):
        self._send(status, json.dumps(payload).encode(), "application/json; charset=utf-8")

    def _query(self):
        return {k: v[-1] for k, v in parse_qs(urlsplit(self.path).query).items()}

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b""
        try:
            return json.loads(raw) if raw else {}
        except ValueError:
            return None

    def _api(self, fn):
        """proxy.cjs apiRoute(): null -> {"error": "no data"}; an exception -> 502."""
        try:
            data = fn()
        except Exception as e:  # noqa: BLE001
            return self._send_json({"error": str(e) or type(e).__name__}, HTTPStatus.BAD_GATEWAY)
        self._send_json(data if data is not None else {"error": "no data"})

    def _passthrough(self, path, base, timeout):
        if not base:
            name = "USAGE_URL" if path.startswith("/api/usage/") else "upstream"
            return self._send_json({"error": "%s not configured" % name}, HTTPStatus.SERVICE_UNAVAILABLE)
        body = None
        if self.command == "POST":
            n = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(n) if n else None
        try:
            res = request(base.rstrip("/") + self.path, method=self.command, body=body, timeout=timeout,
                          headers={"accept": "application/json"})
        except Exception as e:  # noqa: BLE001
            return self._send_json({"error": str(e)}, HTTPStatus.BAD_GATEWAY)
        self._send(res.status, res.raw.encode(), res.headers.get("content-type") or "application/json")

    def _search_stream(self, q, scope=None):
        """NDJSON, one event per line as each search source answers (search.stream)."""
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.close_connection = True
        try:
            for event in search.stream(q, scope):
                self.wfile.write((json.dumps(event) + "\n").encode())
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass  # the page moved on to a newer query
        except Exception as exc:  # noqa: BLE001 - reported to the page as its last event
            self.wfile.write((json.dumps({"type": "done", "groups": [], "error": str(exc)}) + "\n").encode())

    def _static(self, path):
        f = (DIST / path.lstrip("/")).resolve()
        if not str(f).startswith(str(DIST.resolve())) or not f.is_file():
            f = DIST / "index.html"          # SPA fallback, as app.get('*')
        if not f.is_file():
            return self._send_json({"error": "dist/ not built"}, HTTPStatus.NOT_FOUND)
        ctype = mimetypes.guess_type(str(f))[0] or "application/octet-stream"
        self._send(HTTPStatus.OK, f.read_bytes(), ctype)

    # ── routing ───────────────────────────────────────────────────────────────

    def _route(self):
        path = urlsplit(self.path).path
        for prefix, (base, timeout, methods) in routes.PASSTHROUGH.items():
            if path.startswith(prefix) and self.command in methods:
                return self._passthrough(path, base(), timeout)
        if self.command in ("GET", "HEAD"):
            if path in routes.GET:
                return self._api(routes.GET[path])
            q = self._query()
            if path == "/api/search/stream":
                return self._search_stream(q.get("q"), q.get("scope"))
            if path == "/api/search":
                return self._api(lambda: search.search(q.get("q"), q.get("mode", "fast"), q.get("scope")))
            if path == "/api/graph":
                return self._api(lambda: graph.build(q.get("q") or "", expand=q.get("expand") or None, live=q.get("live") == "1"))
            if path.startswith("/api/"):
                return self._send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)
            return self._static(path)
        if self.command == "POST" and path in routes.POST:
            return self._api(routes.POST[path])
        self._send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)

    do_GET = do_POST = do_HEAD = _route


def _collect_loop():
    """Refresh the mirror at start and every COLLECT_MINUTES (default 15; 0 turns it off)."""
    minutes = float(setting("COLLECT_MINUTES", "15"))
    while minutes > 0:
        for name, result in mirror.collect().items():
            print("collect %-10s %s" % (name, result), flush=True)
        time.sleep(minutes * 60)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(setting("PORT", "3010")))
    ap.add_argument("--host", default="0.0.0.0")
    args = ap.parse_args()
    threading.Thread(target=_collect_loop, daemon=True).start()
    ThreadingHTTPServer.daemon_threads = True
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print("docket (home) on http://localhost:%d" % args.port, flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()

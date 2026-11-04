#!/usr/bin/env python3
"""Small, read-only HTTP facade for AIKB search."""
import json
import os
import sqlite3
import sys
import threading
import time
from contextlib import closing
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


DEFAULT_ROOT = "/home/mcglothi/code/AIKB"


def iso(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat()


def clamp(value, default, low, high):
    try:
        return max(low, min(high, int(value)))
    except (TypeError, ValueError):
        return default


def load_search(root):
    search_dir = str(root / "_tools" / "aikb-search")
    if search_dir not in sys.path:
        sys.path.insert(0, search_dir)
    import search  # pylint: disable=import-outside-toplevel
    return search.search


class App:
    def __init__(self, root=None, search_fn=None):
        self.root = Path(root or os.environ.get("AIKB_ROOT", DEFAULT_ROOT)).resolve()
        self.db = self.root / "_tools" / "aikb-search" / "aikb_index.db"
        self.search_fn = search_fn or load_search(self.root)
        self.search_lock = threading.Lock()

    def connect(self):
        # closing(): sqlite3's own context manager only commits, it never closes
        return closing(sqlite3.connect(f"file:{self.db}?mode=ro", uri=True))

    def title(self, relative):
        path = (self.root / relative).resolve()
        try:
            if not path.is_relative_to(self.root):
                raise ValueError
            with path.open(encoding="utf-8") as handle:
                read, fenced, front = 0, False, None
                for n, line in enumerate(handle):
                    read += len(line)
                    # Skip YAML front matter and code fences: a "# " there is a comment, not the title
                    if n == 0 and line.strip() == "---":
                        front = True
                    elif front and line.strip() == "---":
                        front = False
                    elif line.startswith("```"):
                        fenced = not fenced
                    elif not front and not fenced and line.startswith("# "):
                        return line[2:].strip()
                    if read > 16384:
                        break
        except (OSError, UnicodeError, ValueError):
            pass
        return Path(relative).stem

    def chunk_entities(self, results):
        pairs = [(item.get("file", ""), item.get("section", "overview")) for item in results]
        pairs = list(dict.fromkeys(pairs))
        if not pairs:
            return {}
        where = " OR ".join("(c.file_path=? AND c.section=?)" for _ in pairs)
        values = [value for pair in pairs for value in pair]
        sql = f"""SELECT DISTINCT c.file_path, c.section, e.name, e.kind
                   FROM chunks c JOIN entity_chunks ec ON ec.chunk_id=c.id
                   JOIN entities e ON e.id=ec.entity_id
                   WHERE e.kind IN ('host', 'ip') AND ({where})
                   ORDER BY e.name"""
        found = {}
        with self.connect() as conn:
            for file_path, section, name, kind in conn.execute(sql, values):
                found.setdefault((file_path, section), []).append({"name": name, "kind": kind})
        return {key: values[:8] for key, values in found.items()}

    def search(self, query, count):
        # Notes only: the index also holds agent event logs (_runtime/*.json), which the viewer can't open
        with self.search_lock:
            results = self.search_fn(query, top_k=count * 4, use_usage_stats=True)
        notes, seen = [], set()
        for r in results:
            f = r.get("file", "")
            # One row per note, its best section: a long note otherwise fills every slot
            if f.endswith(".md") and not f.startswith("_runtime/") and f not in seen:
                seen.add(f)
                notes.append(r)
        results = notes[:count]
        entities = self.chunk_entities(results)
        return [{
            "file": item.get("file", ""), "section": item.get("section", "overview"),
            "excerpt": item.get("excerpt", ""), "date": item.get("date", ""),
            "score": item.get("score", 0.0), "sources": item.get("sources", []),
            "title": self.title(item.get("file", "")),
            "entities": entities.get((item.get("file", ""), item.get("section", "overview")), []),
        } for item in results]

    def note(self, relative):
        requested = Path(relative)
        components = relative.replace("\\", "/").split("/")
        if requested.is_absolute() or any(part.startswith(".") for part in components if part):
            raise ValueError("invalid path")
        path = (self.root / requested).resolve()
        if path.suffix != ".md" or not path.is_relative_to(self.root):
            raise ValueError("invalid path")
        # Checked again after resolve(): a symlink inside the repo can point at a dot dir or the event logs
        parts = path.relative_to(self.root).parts
        if any(part.startswith(".") for part in parts) or parts[:1] == ("_runtime",):
            raise ValueError("invalid path")
        if not path.exists() or not path.is_file():
            raise FileNotFoundError("note not found")
        if path.stat().st_size > 2 * 1024 * 1024:
            raise ValueError("note is too large")
        return {"path": relative, "title": self.title(relative),
                "mtime": iso(path.stat().st_mtime), "content": path.read_text(encoding="utf-8")}

    def mentions(self, name, limit):
        # A name can be indexed under several kinds (vaultwarden: file, plex: file, sonarr: tag), so match them all.
        # One row per note, the notes that mention it most first; the section is the newest chunk's (SQLite's MAX rule).
        with self.connect() as conn:
            kinds = [k for (k,) in conn.execute("SELECT DISTINCT kind FROM entities WHERE lower(name)=lower(?)", (name,))]
            if not kinds:
                return {"name": name, "kind": None, "notes": []}
            rows = conn.execute("""SELECT c.file_path, c.section, MAX(c.mtime) AS newest, COUNT(DISTINCT c.id) AS hits
                                   FROM entities e JOIN entity_chunks ec ON ec.entity_id=e.id JOIN chunks c ON c.id=ec.chunk_id
                                   WHERE lower(e.name)=lower(?) AND c.file_path LIKE '%.md'
                                     AND substr(c.file_path, 1, 9) != '_runtime/' AND c.file_path NOT LIKE '.%'
                                   GROUP BY c.file_path
                                   ORDER BY hits DESC, newest DESC LIMIT ?""", (name, limit * 4)).fetchall()
        # The note named after it (services/plex.md) leads, however few times it repeats the name
        key = name.lower()
        rows = sorted(rows, key=lambda r: key not in Path(r[0]).stem.lower())[:limit]
        return {"name": name, "kind": "host" if "host" in kinds else kinds[0],
                "notes": [{"file": file_path, "section": section, "title": self.title(file_path), "hits": hits}
                          for file_path, section, _, hits in rows]}


class Handler(BaseHTTPRequestHandler):
    server_version = "AIKBSearchHTTP/1.0"

    def log_message(self, *_):
        pass

    def reply(self, status, body):
        encoded = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        started = time.monotonic()
        status = 500
        parsed = urlsplit(self.path)
        try:
            args = parse_qs(parsed.query)
            app = self.server.app
            if parsed.path == "/healthz":
                with app.connect() as conn:
                    chunks = conn.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
                body = {"ok": True, "chunks": chunks, "index_mtime": iso(app.db.stat().st_mtime), "root": str(app.root)}
                status = 200
            elif parsed.path == "/search":
                query = args.get("q", [""])[0]
                if len(query) < 2:
                    raise ValueError("q must be at least 2 characters")
                count = clamp(args.get("k", [8])[0], 8, 1, 25)
                body = {"q": query, "seconds": 0, "results": app.search(query, count)}
                body["seconds"] = round(time.monotonic() - started, 4)
                status = 200
            elif parsed.path == "/note":
                body, status = app.note(args.get("path", [""])[0]), 200
            elif parsed.path == "/mentions":
                body, status = app.mentions(args.get("name", [""])[0], clamp(args.get("limit", [20])[0], 20, 1, 50)), 200
            else:
                body, status = {"error": "not found"}, 404
        except FileNotFoundError as exc:
            body, status = {"error": str(exc)}, 404
        except ValueError as exc:
            body, status = {"error": str(exc)}, 400
        except Exception as exc:  # Keep the API failure visible to a local dashboard.
            body, status = {"error": str(exc)}, 500
        self.reply(status, body)
        elapsed = round((time.monotonic() - started) * 1000)
        print(f"{self.command} {parsed.path} {status} {elapsed}ms", file=sys.stderr, flush=True)

    def do_POST(self):
        self.reply(405, {"error": "method not allowed"})

    do_PUT = do_POST
    do_DELETE = do_POST


def make_server(root=None, search_fn=None, host=None, port=None):
    app = App(root, search_fn)
    server = ThreadingHTTPServer((host or os.environ.get("HOST", "0.0.0.0"),
                                  int(port if port is not None else os.environ.get("PORT", 8793))), Handler)
    server.app = app
    return server


def warm_up(app):
    try:
        with app.search_lock:
            app.search_fn("warmup", top_k=1, use_usage_stats=True)
    except Exception as exc:
        print(f"warm-up failed: {exc}", file=sys.stderr, flush=True)


if __name__ == "__main__":
    httpd = make_server()
    threading.Thread(target=warm_up, args=(httpd.app,), daemon=True).start()
    httpd.serve_forever()

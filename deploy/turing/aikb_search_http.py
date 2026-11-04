#!/usr/bin/env python3
"""Small, read-only HTTP facade for AIKB search."""
import json
import math
import os
import sqlite3
import sys
import threading
import time
import re
from contextlib import closing
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit


DEFAULT_ROOT = "/home/mcglothi/code/AIKB"
VIDEOS = "media/youtube/"
# Concept SQL also skips generic filenames (readme, index, changelog, ...): the indexer records them as "file" entities


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


def _as_list(value):
    """A hand-edited `pending: none` must not be iterated as characters downstream."""
    return value if isinstance(value, list) else []


class StateUnavailable(RuntimeError):
    pass


class App:
    def __init__(self, root=None, search_fn=None):
        self.root = Path(root or os.environ.get("AIKB_ROOT", DEFAULT_ROOT)).resolve()
        self.db = self.root / "_tools" / "aikb-search" / "aikb_index.db"
        self.search_fn = search_fn or load_search(self.root)
        self.search_lock = threading.Lock()
        self.state_mtime = None
        self.state_value = None
        self.state_lock = threading.Lock()

    @staticmethod
    def _short(value):
        if hasattr(value, "isoformat"):
            value = value.isoformat()
        return value[:400] if isinstance(value, str) else value

    def _open_note(self, value):
        if not isinstance(value, str) or not value.endswith(".md"):
            return None
        try:
            self.note(value)  # exactly the viewer's rules: absolute paths, symlinks, dot dirs, _runtime
        except (OSError, ValueError):
            return None
        return value

    def state(self):
        """The curated state file is small; mtime avoids parsing it on every graph refresh."""
        path = self.root / "_state.yaml"
        try:
            mtime = path.stat().st_mtime_ns
        except OSError as exc:
            raise StateUnavailable(str(exc)) from None
        with self.state_lock:
            if self.state_mtime == mtime and self.state_value is not None:
                return self.state_value
            try:
                import yaml  # pylint: disable=import-outside-toplevel
            except ImportError as exc:
                raise StateUnavailable("PyYAML is unavailable") from exc
            try:
                data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            except (OSError, UnicodeError, yaml.YAMLError) as exc:
                raise StateUnavailable(str(exc)) from None
            if not isinstance(data, dict):
                raise StateUnavailable("_state.yaml is not a mapping")
            certs = []
            for raw in _as_list(data.get("ssl_certs")):
                if not isinstance(raw, dict):
                    continue
                certs.append({"name": self._short(raw.get("name")), "npm_cert_id": self._short(raw.get("npm_cert_id")),
                              "expires": self._short(raw.get("expires")), "warn_after": self._short(raw.get("warn_after")),
                              "file": self._open_note(raw.get("file"))})
            pending = []
            for raw in _as_list(data.get("pending")):
                if not isinstance(raw, dict):
                    continue
                pending.append({"item": self._short(raw.get("item")), "detail": self._short(raw.get("detail")),
                                "blocked_by": self._short(raw.get("blocked_by")), "priority": self._short(raw.get("priority")),
                                "project": self._short(raw.get("project")), "file": self._open_note(raw.get("file"))})
            def trim(value):
                if isinstance(value, str) or hasattr(value, "isoformat"):  # YAML dates must stay JSON-able
                    return self._short(value)
                if isinstance(value, list):
                    return [trim(v) for v in value]
                if isinstance(value, dict):
                    return {k: self._open_note(v) if k == "file" else trim(v) for k, v in value.items()}
                return value
            self.state_value = {"last_updated": self._short(data.get("last_updated")), "ssl_certs": certs,
                                "open_incidents": trim(_as_list(data.get("open_incidents"))), "pending": pending}
            self.state_mtime = mtime
            return self.state_value

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

    @staticmethod
    def _note_where(alias="c"):
        return (f"{alias}.file_path LIKE '%.md' AND substr({alias}.file_path, 1, 9) != '_runtime/' "
                f"AND {alias}.file_path NOT LIKE '.%' AND {alias}.file_path NOT LIKE '%/.%'")

    def _search_files(self, query, count):
        """One search hit per openable note, preserving hybrid-search ranking."""
        with self.search_lock:
            results = self.search_fn(query, top_k=count * 4, use_usage_stats=True)
        files = []
        for row in results:
            path = row.get("file", "")
            if (path.endswith(".md") and not path.startswith("_runtime/") and not path.startswith(".")
                    and "/." not in path and path not in files):
                files.append(path)
        return files[:count]

    def concepts(self, query, notes, limit, videos=False):
        """Small co-occurrence graph over meaningful, indexed note entities. YouTube notes (media/youtube/) only
        with videos: there are enough of them that "watch" and "youtube" otherwise lead every graph."""
        all_notes = not query.strip() or query.strip().lower() in ("*", "all")
        files = [] if all_notes else [f for f in self._search_files(query, notes * (1 if videos else 3))
                                      if videos or not f.startswith(VIDEOS)][:notes]
        clause, values = self._note_where("c"), []
        if not videos:
            clause += " AND substr(c.file_path, 1, %d) != '%s'" % (len(VIDEOS), VIDEOS)
        if files:
            clause += " AND c.file_path IN (%s)" % ",".join("?" * len(files))
            values = files
        elif not all_notes:
            return {"q": query, "chunks": 0, "notes": [], "concepts": [], "edges": []}
        with self.connect() as conn:
            chunks = conn.execute("SELECT COUNT(*) FROM chunks c WHERE " + clause, values).fetchone()[0]
            if all_notes:
                files = [r[0] for r in conn.execute("SELECT DISTINCT c.file_path FROM chunks c WHERE " + clause + " ORDER BY c.file_path", values)]
            rows = conn.execute("""SELECT e.id, e.name, e.kind, COUNT(DISTINCT c.id), COUNT(DISTINCT c.file_path)
                                 FROM chunks c JOIN entity_chunks ec ON ec.chunk_id=c.id JOIN entities e ON e.id=ec.entity_id
                                 WHERE %s AND e.kind IN ('tag', 'host', 'file') AND lower(e.name) NOT IN ('readme', 'index', '_index', 'changelog', 'todo', 'license')
                                 GROUP BY e.id ORDER BY COUNT(DISTINCT c.id) DESC, lower(e.name), e.kind""" % clause, values).fetchall()
            if all_notes:
                rows = [r for r in rows if r[3] >= 3]
            rows = rows[:limit]
            ids = [r[0] for r in rows]
            pairs = []
            if ids:
                marks = ",".join("?" * len(ids))
                pairs = conn.execute("""SELECT e1.id, e2.id, COUNT(DISTINCT c.id)
                                        FROM chunks c JOIN entity_chunks x ON x.chunk_id=c.id
                                        JOIN entity_chunks y ON y.chunk_id=c.id AND x.entity_id < y.entity_id
                                        JOIN entities e1 ON e1.id=x.entity_id JOIN entities e2 ON e2.id=y.entity_id
                                        WHERE %s AND x.entity_id IN (%s) AND y.entity_id IN (%s)
                                        GROUP BY e1.id, e2.id""" % (clause, marks, marks), values + ids + ids).fetchall()
        kept = {r[0]: r for r in rows}
        best = {}
        for a, b, weight in pairs:
            if chunks > 200 and weight < 2:
                continue
            best.setdefault(a, []).append((weight, b))
            best.setdefault(b, []).append((weight, a))
        allow = {tuple(sorted((a, b))) for a, links in best.items() for _, b in sorted(links, reverse=True)[:8]}
        return {"q": query, "chunks": chunks,
                "notes": files if not all_notes else [],
                "concepts": [{"name": r[1], "kind": r[2], "count": r[3], "notes": r[4]} for r in rows],
                "edges": [{"a": kept[a][1], "b": kept[b][1], "w": w} for a, b, w in pairs
                          if tuple(sorted((a, b))) in allow and not (chunks > 200 and w < 2)]}

    def context(self, name, query, limit):
        # The graph's search as typed: drop a scope prefix (kb:, host:) and treat * / all as every note
        query = re.sub(r"^\s*(aikb|kb|notes|hosts?|h|apps?|media|m)\s*:", "", query or "", flags=re.I).strip()
        if query.lower() in ("*", "all"):
            query = ""
        files = self._search_files(query, max(limit, 8)) if query else []
        clause, values = self._note_where("c"), [name]
        if query and not files:
            return {"name": name, "items": []}
        if files:
            clause += " AND c.file_path IN (%s)" % ",".join("?" * len(files))
            values += files
        with self.connect() as conn:
            rows = conn.execute("""SELECT c.file_path, c.section, c.content
                                 FROM chunks c JOIN entity_chunks ec ON ec.chunk_id=c.id JOIN entities e ON e.id=ec.entity_id
                                 WHERE lower(e.name)=lower(?) AND e.kind IN ('tag', 'host', 'file') AND lower(e.name) NOT IN ('readme', 'index', '_index', 'changelog', 'todo', 'license') AND %s
                                 GROUP BY c.file_path ORDER BY c.mtime DESC LIMIT ?""" % clause, values + [limit]).fetchall()
        needle = name.lower()
        def excerpt(content):
            at = content.lower().find(needle)
            start = max(0, at - 90) if at >= 0 else 0
            return content[start:start + 280]
        return {"name": name, "items": [{"file": path, "section": section, "title": self.title(path), "excerpt": excerpt(content)}
                                        for path, section, content in rows]}

    def related(self, relative, limit):
        source = self.note(relative)  # exactly the note endpoint's validation
        with self.connect() as conn:
            target = conn.execute("""SELECT DISTINCT e.id, e.name FROM chunks c JOIN entity_chunks ec ON ec.chunk_id=c.id
                                   JOIN entities e ON e.id=ec.entity_id WHERE c.file_path=? AND e.kind IN ('tag', 'host', 'file') AND lower(e.name) NOT IN ('readme', 'index', '_index', 'changelog', 'todo', 'license')""",
                                  (relative,)).fetchall()
            if not target:
                return {"path": relative, "items": []}
            ids = [r[0] for r in target]
            marks = ",".join("?" * len(ids))
            shared = conn.execute("""SELECT c.file_path, e.id, e.name FROM chunks c JOIN entity_chunks ec ON ec.chunk_id=c.id
                                  JOIN entities e ON e.id=ec.entity_id WHERE %s AND c.file_path != ? AND e.id IN (%s)
                                  GROUP BY c.file_path, e.id""" % (self._note_where("c"), marks), [relative] + ids).fetchall()
            by_file = {}
            for path, entity_id, name in shared:
                by_file.setdefault(path, {})[entity_id] = name
            paths = list(by_file)
            all_sets = {p: set(names) for p, names in by_file.items()}
            if paths:
                marks = ",".join("?" * len(paths))
                rows = conn.execute("""SELECT c.file_path, e.id FROM chunks c JOIN entity_chunks ec ON ec.chunk_id=c.id
                                     JOIN entities e ON e.id=ec.entity_id WHERE c.file_path IN (%s) AND e.kind IN ('tag', 'host', 'file') AND lower(e.name) NOT IN ('readme', 'index', '_index', 'changelog', 'todo', 'license')
                                     GROUP BY c.file_path, e.id""" % marks, paths).fetchall()
                for path, entity_id in rows:
                    all_sets.setdefault(path, set()).add(entity_id)
            # Rare concepts count for more (IDF): sharing docker and truenas says little, sharing litestream a lot
            union = {r[0] for r in target}.union(*all_sets.values())
            marks = ",".join("?" * len(union))
            df = dict(conn.execute("""SELECT ec.entity_id, COUNT(DISTINCT c.file_path) FROM entity_chunks ec
                                      JOIN chunks c ON c.id=ec.chunk_id WHERE ec.entity_id IN (%s)
                                      GROUP BY ec.entity_id""" % marks, list(union)).fetchall())
            files = conn.execute("SELECT COUNT(DISTINCT file_path) FROM chunks").fetchone()[0] or 1
        idf = lambda i: math.log(1 + files / (df.get(i) or 1))
        target_ids = {r[0] for r in target}
        scored = []
        for path, names in by_file.items():
            if len(names) < 2:
                continue
            score = sum(map(idf, names)) / sum(map(idf, target_ids | all_sets[path]))
            # Shared names rarest first, so the row shows why it's related
            scored.append((score, path, [names[i] for i in sorted(names, key=idf, reverse=True)]))
        scored.sort(key=lambda r: (-r[0], r[1]))
        def linked(text, other):
            # Whole names only: "nas" must not match a link to truenas.md
            choices = {other.lower(), Path(other).name.lower(), Path(other).stem.lower()}
            for pair in re.findall(r"\]\(([^)]*)\)|\[\[([^]]*)\]\]", text.lower()):
                for d in pair:
                    d = re.split(r"[#|]", d.strip(), 1)[0].strip()
                    if d and (d in choices or any(d.endswith("/" + t) for t in choices)):
                        return True
            return False
        items = []
        for score, path, names in scored[:limit]:
            try:
                content = self.note(path)["content"]
            except (OSError, ValueError, FileNotFoundError):
                continue
            items.append({"file": path, "title": self.title(path), "shared": names[:6],
                          "score": round(score, 4), "linked": linked(source["content"], path) or linked(content, relative)})
        return {"path": relative, "items": items}


    def links(self, paths, limit):
        """The names each note mentions (hosts, IPs, files, tags; not free terms), for joining notes to the fleet."""
        paths = [p for p in dict.fromkeys(paths) if p.endswith(".md")][:25]
        if not paths:
            return {"links": {}, "titles": {}}
        marks = ",".join("?" * len(paths))
        found = {p: [] for p in paths}
        with self.connect() as conn:
            for file_path, name, kind, hits in conn.execute(f"""SELECT c.file_path, e.name, e.kind, COUNT(DISTINCT c.id) AS hits
                                                  FROM chunks c JOIN entity_chunks ec ON ec.chunk_id=c.id JOIN entities e ON e.id=ec.entity_id
                                                  WHERE c.file_path IN ({marks}) AND e.kind IN ('host', 'ip', 'file', 'tag')
                                                  GROUP BY c.file_path, e.id ORDER BY hits DESC""", paths):
                if len(found[file_path]) < limit:
                    found[file_path].append({"name": name, "kind": kind, "hits": hits})
        return {"links": found, "titles": {p: self.title(p) for p in found}}


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
            elif parsed.path == "/state":
                body, status = app.state(), 200
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
            elif parsed.path == "/links":
                body, status = app.links(args.get("path", []), clamp(args.get("limit", [80])[0], 80, 1, 300)), 200
            elif parsed.path == "/mentions":
                body, status = app.mentions(args.get("name", [""])[0], clamp(args.get("limit", [20])[0], 20, 1, 50)), 200
            elif parsed.path == "/concepts":
                body, status = app.concepts(args.get("q", [""])[0], clamp(args.get("notes", [15])[0], 15, 1, 40),
                                            clamp(args.get("limit", [60])[0], 60, 5, 150), args.get("videos", ["0"])[0] == "1"), 200
            elif parsed.path == "/context":
                body, status = app.context(args.get("name", [""])[0], args.get("q", [""])[0],
                                           clamp(args.get("limit", [8])[0], 8, 1, 50)), 200
            elif parsed.path == "/related":
                body, status = app.related(args.get("path", [""])[0], clamp(args.get("limit", [8])[0], 8, 1, 50)), 200
            else:
                body, status = {"error": "not found"}, 404
        except StateUnavailable as exc:
            body, status = {"error": str(exc)}, 503
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

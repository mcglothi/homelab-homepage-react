#!/usr/bin/env python3
import importlib.util
import json
import sqlite3
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


MODULE = Path(__file__).with_name("aikb_search_http.py")
spec = importlib.util.spec_from_file_location("aikb_search_http", MODULE)
api = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = api
spec.loader.exec_module(api)


class APITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "notes").mkdir()
        (self.root / ".private").mkdir()
        (self.root / "notes" / "one.md").write_text("# First note\n\nAlpha content.\n")
        (self.root / "notes" / "two.md").write_text("# Second note\n\nBeta content.\n")
        (self.root / ".private" / "hidden.md").write_text("secret")
        (self.root / "notes" / "plain.txt").write_text("not markdown")
        (self.root / "notes" / "escape.md").symlink_to("/tmp/outside.md")
        tool = self.root / "_tools" / "aikb-search"
        tool.mkdir(parents=True)
        db = sqlite3.connect(tool / "aikb_index.db")
        db.executescript("""CREATE TABLE chunks(id INTEGER PRIMARY KEY, file_path TEXT, section TEXT, content TEXT, tags TEXT, mtime REAL, embedding BLOB);
        CREATE TABLE entities(id INTEGER PRIMARY KEY, name TEXT UNIQUE COLLATE NOCASE, kind TEXT);
        CREATE TABLE entity_chunks(entity_id INTEGER, chunk_id INTEGER);""")
        db.executemany("INSERT INTO chunks VALUES (?, ?, ?, '', '', ?, NULL)", [
            (1, "notes/one.md", "overview", 100), (2, "notes/two.md", "Details", 200)])
        db.executemany("INSERT INTO entities VALUES (?, ?, ?)", [(1, "turing", "host"), (2, "10.0.0.2", "ip"), (3, "misc", "term")])
        db.executemany("INSERT INTO entity_chunks VALUES (?, ?)", [(1, 1), (2, 1), (1, 2), (3, 2)])
        db.commit()
        db.close()

        def fake_search(query, top_k=5, **_):
            return [{"file": "notes/one.md", "section": "overview", "excerpt": "Alpha", "date": "2026-01-01", "score": 1.0, "sources": ["test"]}][:top_k]
        try:
            self.server = api.make_server(self.root, fake_search, "127.0.0.1", 0)
        except PermissionError as exc:
            self.skipTest(f"localhost sockets unavailable: {exc}")
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, path, method="GET"):
        try:
            with urlopen(Request(self.base + path, method=method)) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            return error.code, json.load(error)

    def test_healthz(self):
        status, body = self.request("/healthz")
        self.assertEqual((status, body["chunks"], body["root"]), (200, 2, str(self.root.resolve())))

    def test_search_shape_entities_and_k_clamp(self):
        status, body = self.request("/search?q=alpha&k=99")
        self.assertEqual(status, 200)
        self.assertEqual(body["q"], "alpha")
        self.assertIn("seconds", body)
        self.assertEqual(body["results"][0]["title"], "First note")
        self.assertEqual(body["results"][0]["entities"], [{"name": "10.0.0.2", "kind": "ip"}, {"name": "turing", "kind": "host"}])
        self.assertEqual(api.clamp("99", 8, 1, 25), 25)
        self.assertEqual(api.clamp("0", 8, 1, 25), 1)

    def test_short_query(self):
        status, body = self.request("/search?q=x")
        self.assertEqual(status, 400)
        self.assertIn("error", body)

    def test_note_and_rejections(self):
        status, body = self.request("/note?path=notes/one.md")
        self.assertEqual((status, body["title"]), (200, "First note"))
        for path in ("../notes/one.md", "%2e%2e/notes/one.md", "%2Ftmp%2Foutside.md",
                     ".private/hidden.md", "notes/escape.md", "notes/plain.txt"):
            status, body = self.request("/note?path=" + path)
            self.assertEqual(status, 400, path)
            self.assertIn("error", body)

    def test_mentions_known_and_unknown(self):
        status, body = self.request("/mentions?name=turing&limit=99")
        self.assertEqual((status, body["kind"], len(body["notes"])), (200, "host", 2))
        self.assertEqual(body["notes"][0]["file"], "notes/two.md")
        status, body = self.request("/mentions?name=missing")
        self.assertEqual((status, body["kind"], body["notes"]), (200, None, []))

    def test_not_found_and_method(self):
        self.assertEqual(self.request("/nope")[0], 404)
        self.assertEqual(self.request("/healthz", "POST")[0], 405)


if __name__ == "__main__":
    unittest.main(verbosity=2)

import os
import sys
import tempfile
import unittest

os.environ["DATA_DIR"] = tempfile.mkdtemp()
sys.path.insert(0, "backend")

from homeapi import graph


class GraphNotesTest(unittest.TestCase):
    NODES = {"h:babbage": {"kind": "host", "label": "babbage"}, "a:plex": {"kind": "app", "label": "plex"},
             "ds:tank": {"kind": "dataset", "label": "tank"}}

    def setUp(self):
        self.fetch, self.fleet_get, self.all = graph.fetch_local, graph.fleet.get, graph._all

    def tearDown(self):
        graph.fetch_local, graph.fleet.get, graph._all = self.fetch, self.fleet_get, self.all

    def fake_aikb(self, url, **kwargs):
        self.urls.append(url)
        if "/search?" in url:
            return {"results": [{"file": "ops/litestream.md", "title": "Litestream"}]}
        if "/links?" in url:
            return {"links": {"ops/litestream.md": [{"name": "Babbage", "kind": "host"}, {"name": "10.10.10.50", "kind": "ip"},
                                                     {"name": "nothing-here", "kind": "tag"}]}}
        return {"notes": []}

    def fleet(self):
        nodes = {"h:babbage": {"id": "h:babbage", "kind": "host", "label": "babbage"},
                 "h:turing": {"id": "h:turing", "kind": "host", "label": "turing"},
                 "a:plex": {"id": "a:plex", "kind": "app", "label": "plex"}}
        graph.fleet.get = lambda: {"ip_of": {"10.10.10.50": "turing"}}
        graph._all = lambda F, live=False: (dict(nodes), [{"a": "h:babbage", "b": "a:plex", "kind": "runs"}])
        self.urls = []
        graph.fetch_local = self.fake_aikb

    def test_text_search_starts_from_notes(self):
        self.fleet()
        d = graph.build("litestream")
        self.assertEqual(d["seeds"], ["n:ops/litestream.md"])
        # joined by label (any case) and by IP; the unmatched tag adds nothing, and the joined hosts come alone
        self.assertEqual(sorted(e["a"] for e in d["edges"] if e["via"] == "AIKB"), ["h:babbage", "h:turing"])
        self.assertEqual(sorted(n["id"] for n in d["nodes"]), ["h:babbage", "h:turing", "n:ops/litestream.md"])

    def test_kb_scope_skips_fleet_seeds(self):
        self.fleet()
        d = graph.build("kb:plex")
        self.assertEqual(d["seeds"], ["n:ops/litestream.md"])     # not a:plex
        self.assertTrue(any("/search?q=plex&" in u for u in self.urls), self.urls)   # the prefix is stripped

    def test_expand_note(self):
        self.fleet()
        d = graph.build("", expand="n:ops/litestream.md")
        self.assertEqual(sorted(n["id"] for n in d["nodes"]), ["h:babbage", "h:turing", "n:ops/litestream.md"])

    def test_shared_note_is_one_node(self):
        asked = []

        def fake(url, **kwargs):
            asked.append(url)
            return {"notes": [{"file": "home-lab/services/plex.md", "section": "Setup", "title": "Plex"}]}
        graph.fetch_local = fake
        notes, edges = graph._notes(list(self.NODES), self.NODES)
        self.assertEqual(len(asked), 2)   # the dataset isn't asked about
        self.assertEqual(list(notes), ["n:home-lab/services/plex.md"])
        self.assertEqual(dict(notes["n:home-lab/services/plex.md"]["attrs"])["Open"], "/aikb/note?path=home-lab%2Fservices%2Fplex.md")
        self.assertEqual(sorted(e["a"] for e in edges), ["a:plex", "h:babbage"])

    def test_aikb_down(self):
        def boom(*args, **kwargs):
            raise OSError("refused")
        graph.fetch_local = boom
        self.assertEqual(graph._notes(["h:babbage"], self.NODES), (None, []))
        graph.fetch_local = lambda *args, **kwargs: {"error": "database is locked"}
        self.assertEqual(graph._notes(["h:babbage"], self.NODES), (None, []))


if __name__ == "__main__":
    unittest.main()

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
        self.fetch = graph.fetch_local

    def tearDown(self):
        graph.fetch_local = self.fetch

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

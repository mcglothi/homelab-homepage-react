import os
import sys
import tempfile
import unittest

os.environ["DATA_DIR"] = tempfile.mkdtemp()
sys.path.insert(0, "backend")

from homeapi import search


class AikbSourceTest(unittest.TestCase):
    def setUp(self):
        self.fetch = search.fetch_local

    def tearDown(self):
        search.fetch_local = self.fetch

    def test_item_shape(self):
        search.fetch_local = lambda *args, **kwargs: {"results": [{
            "file": "home-lab/services/monitoring.md", "section": "Scrubs", "excerpt": "## Scrubs\n  weekly check", "date": "2026-11-03",
            "title": "Monitoring", "entities": [{"name": "turing", "kind": "host"}, {"name": "zfs", "kind": "topic"}],
        }]}
        group = search._aikb("zfs")
        self.assertEqual(group["source"], "aikb")
        self.assertEqual(group["items"][0], {"title": "Monitoring · Scrubs", "subtitle": "home-lab/services/monitoring.md · 2026-11-03",
                                                "detail": "Scrubs weekly check", "href": "/aikb/note?path=home-lab%2Fservices%2Fmonitoring.md&section=Scrubs",
                                                "internal": True, "children": [{"title": "turing", "subtitle": "host"}]})

    def test_empty_is_none(self):
        search.fetch_local = lambda *args, **kwargs: {"results": []}
        self.assertIsNone(search._aikb("zfs"))

    def test_plan_and_scope(self):
        self.assertNotIn("AIKB", [name for name, _ in search.plan("zf")[2]])
        self.assertIn("AIKB", [name for name, _ in search.plan("zfs")[2]])
        self.assertEqual(search.parse_scope("kb: zfs"), ("aikb", "zfs"))
        original = search.fast
        try:
            search.fast = lambda q: [{"source": "host", "title": "Hosts", "items": [{"title": "turing"}]}]
            self.assertEqual(search.search("zfs", scope="aikb")["groups"], [])
        finally:
            search.fast = original


if __name__ == "__main__":
    unittest.main()

import os
import sys
import tempfile
import unittest

os.environ["DATA_DIR"] = tempfile.mkdtemp()
sys.path.insert(0, "backend")

from homeapi import graph

NOTE = """# Vaultwarden

Intro mentions nothing.

## Deploy
Runs on babbage behind the proxy.

```
## not a heading inside code
```

## Backups
litestream replicates to truenas. babbage-old is a different host.

## Notes ##
"""


class SectionsTest(unittest.TestCase):
    def setUp(self):
        self.aikb = graph._aikb

    def tearDown(self):
        graph._aikb = self.aikb

    def test_headings_skip_fenced_code(self):
        self.assertEqual([h for h, _ in graph.note_sections(NOTE)], ["Deploy", "Backups", "Notes"])

    def test_fleet_links_move_to_the_section_that_names_them(self):
        graph._aikb = lambda endpoint, **kw: {"content": NOTE} if endpoint == "/note" else None
        nodes = {"h:babbage": {"label": "babbage"}, "h:truenas": {"label": "truenas"}, "a:plex": {"label": "plex"}}
        nid = "n:svc/vw.md"
        joins = [{"a": a, "b": nid, "kind": "about", "label": "mentions"} for a in nodes]
        secs, edges, left = graph._sections("svc/vw.md", joins, nodes)
        self.assertEqual(sorted(secs), [nid + "#backups", nid + "#deploy", nid + "#notes"])
        moved = {e["a"]: e["b"] for e in edges if e["kind"] == "about"}
        self.assertEqual(moved, {"h:babbage": nid + "#deploy", "h:truenas": nid + "#backups"})
        self.assertEqual([e["a"] for e in left], ["a:plex"])   # named nowhere: stays on the note
        self.assertEqual(sum(1 for e in edges if e["kind"] == "section"), 3)

    def test_one_heading_adds_nothing(self):
        graph._aikb = lambda endpoint, **kw: {"content": "## Only\nbabbage"}
        joins = [{"a": "h:babbage", "b": "n:x.md", "kind": "about"}]
        self.assertEqual(graph._sections("x.md", joins, {"h:babbage": {"label": "babbage"}}), ({}, [], joins))


    def test_expanding_a_section_expands_its_note(self):
        seen = {}
        graph_fleet = graph.fleet.get
        try:
            graph.fleet.get = lambda: {}
            def spy(q, expand, F, videos=False):
                seen["expand"] = expand
                return {}
            orig = graph._concept_graph
            graph._concept_graph = spy
            graph.build("x", expand="n:svc/vw.md#deploy", lens="concepts")
        finally:
            graph.fleet.get = graph_fleet
            graph._concept_graph = orig
        self.assertEqual(seen["expand"], "n:svc/vw.md")


if __name__ == "__main__":
    unittest.main()

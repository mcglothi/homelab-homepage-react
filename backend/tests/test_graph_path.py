import os
import sys
import tempfile
import unittest

os.environ["DATA_DIR"] = tempfile.mkdtemp()
sys.path.insert(0, "backend")

from homeapi import graph, search


def node(id, kind, label):
    return {"id": id, "kind": kind, "label": label, "sub": "", "attrs": []}


class GraphPathTest(unittest.TestCase):
    def setUp(self):
        self.fleet_get, self.all, self.notes, self.joins, self.aikb, self.build = graph.fleet.get, graph._all, graph._notes, graph._joins, graph._aikb, graph.build
        graph.fleet.get = lambda: {"ip_of": {}}
        self.nodes = {"a:plex": node("a:plex", "app", "plex"), "h:store": node("h:store", "host", "store"),
                      "a:vault": node("a:vault", "app", "vaultwarden")}
        graph._all = lambda F, live=False: (dict(self.nodes), [{"a": "a:plex", "b": "h:store", "kind": "runs", "label": "runs on", "via": "TrueNAS"}])
        graph._notes = lambda ids, nodes: ({"n:bridge.md": node("n:bridge.md", "note", "bridge")}, [{"a": "a:plex", "b": "n:bridge.md", "kind": "about", "label": "mentions", "via": "AIKB"}])
        graph._joins = lambda files, nodes, F: ([{"a": "a:vault", "b": "n:bridge.md", "kind": "about", "label": "mentions", "via": "AIKB"}], {})
        graph._aikb = lambda *a, **k: {"results": []}   # never the live facade

    def tearDown(self):
        graph.fleet.get, graph._all, graph._notes, graph._joins, graph._aikb, graph.build = self.fleet_get, self.all, self.notes, self.joins, self.aikb, self.build

    def test_parse_path(self):
        self.assertEqual(search.parse_path("plex .. vaultwarden"), ("plex", "vaultwarden"))
        self.assertEqual(search.parse_path("path: plex .. vaultwarden"), ("plex", "vaultwarden"))
        self.assertEqual(search.parse_path("path: plex -> vaultwarden"), ("plex", "vaultwarden"))
        self.assertEqual(search.parse_path("path: plex to vaultwarden"), ("plex", "vaultwarden"))
        self.assertEqual(search.parse_path("plex -> vaultwarden"), ("plex", "vaultwarden"))
        self.assertEqual(search.parse_path("host:babbage .. turing"), ("babbage", "turing"))
        for q in ("10.10.10.1..10.10.10.50", "v1..v2", "how to restore vaultwarden"):
            self.assertIsNone(search.parse_path(q), q)

    def test_path_build_uses_note_bridge_and_marks_endpoints(self):
        data = graph.build("plex .. vaultwarden")
        self.assertEqual(data["path"]["routes"][0]["ids"], ["a:plex", "n:bridge.md", "a:vault"])
        self.assertEqual(data["path"]["routes"][0]["confidence"], "extracted")
        self.assertEqual({n["id"] for n in data["nodes"] if n.get("result")}, {"a:plex", "a:vault"})
        self.assertTrue(all(e["prov"] == "extracted" for e in data["edges"]))

    def test_ambiguous_join_and_provenance(self):
        nodes = {"h:one": node("h:one", "host", "shared"), "a:two": node("a:two", "app", "shared")}
        graph._joins = self.joins
        graph._aikb = lambda *a, **k: {"links": {"note.md": [{"name": "shared"}]}}
        edges, _ = graph._joins(["note.md"], nodes, {"ip_of": {}})
        self.assertEqual([e["prov"] for e in edges], ["ambiguous", "ambiguous"])
        self.assertEqual([e["flag"] for e in edges], ["ambiguous", "ambiguous"])
        self.assertEqual([e["prov"] for e in graph._with_provenance([{"kind": "net", "flag": "derived"}, {"kind": "net", "flag": "missing"}, {"kind": "member"}])], ["inferred", "ambiguous", "extracted"])

    def test_end_outside_fleet_falls_back_to_a_note(self):
        graph._aikb = lambda endpoint, **k: {"results": [{"file": "ops/litestream.md", "title": "Litestream"}]}
        graph._joins = lambda files, nodes, F: ([{"a": "h:store", "b": "n:ops/litestream.md", "kind": "about", "label": "mentions", "via": "AIKB"}], {})
        data = graph.build("plex .. litestream")
        self.assertEqual(data["path"]["routes"][0]["ids"], ["a:plex", "h:store", "n:ops/litestream.md"])
        self.assertTrue(any("using the note Litestream" in w for w in data["warnings"]))

    def test_exact_app_beats_partial_and_dataset(self):
        self.nodes["ds:vw"] = node("ds:vw", "dataset", "vaultwarden")
        self.assertEqual(graph.build("plex .. vaultwarden")["path"]["to"], "a:vault")

    def test_no_match_and_no_route_are_empty_with_warnings(self):
        missing = graph.build("nothing .. vaultwarden")
        self.assertEqual(missing["nodes"], [])
        self.assertIn("nothing matches 'nothing'", missing["warnings"])
        graph._notes = lambda ids, nodes: ({}, [])
        graph._joins = lambda files, nodes, F: ([], {})
        no_route = graph.build("plex .. vaultwarden")
        self.assertEqual(no_route["nodes"], [])
        self.assertTrue(any("no path" in w for w in no_route["warnings"]))

    def test_path_search_source_has_route_detail(self):
        graph.build = lambda q: {"nodes": [node("a:plex", "app", "plex"), node("a:vault", "app", "vaultwarden")],
                                  "edges": [{"a": "a:plex", "b": "a:vault", "kind": "runs", "label": "runs on", "via": "TrueNAS", "prov": "extracted"}],
                                  "path": {"routes": [{"ids": ["a:plex", "a:vault"], "hops": 1, "confidence": "extracted"}]}}
        data = search.search("plex .. vaultwarden", mode="full")
        item = data["groups"][0]["items"][0]
        self.assertEqual(data["groups"][0]["source"], "path")
        self.assertEqual(item["title"], "plex → vaultwarden")
        self.assertIn("runs on", item["detail"])


if __name__ == "__main__":
    unittest.main()

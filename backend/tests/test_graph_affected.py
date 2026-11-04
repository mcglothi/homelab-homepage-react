import os
import sys
import tempfile
import unittest

os.environ["DATA_DIR"] = tempfile.mkdtemp()
sys.path.insert(0, "backend")

from homeapi import graph, search


def node(id, kind, label):
    return {"id": id, "kind": kind, "label": label, "sub": "", "attrs": []}


class GraphAffectedTest(unittest.TestCase):
    def setUp(self):
        self.get, self.all, self.data = graph.fleet.get, graph._all, graph.common.DATA_DIR
        graph.common.DATA_DIR = __import__("pathlib").Path(tempfile.mkdtemp())
        graph.fleet.get = lambda: {"ip_of": {}}
        self.nodes = {
            "h:one": node("h:one", "host", "one"), "h:two": node("h:two", "host", "two"),
            "ds:data": node("ds:data", "dataset", "data"), "a:one": node("a:one", "app", "one-app"),
            "a:two": node("a:two", "app", "two-app"), "a:chain1": node("a:chain1", "app", "chain1"),
            "a:chain2": node("a:chain2", "app", "chain2"), "a:chain3": node("a:chain3", "app", "chain3"),
            "a:chain4": node("a:chain4", "app", "chain4"), "a:chain5": node("a:chain5", "app", "chain5"),
            "px:one": node("px:one", "proxy", "one.example"), "px:two": node("px:two", "proxy", "two.example"),
            "h:vm": node("h:vm", "host", "vm"), "cert:one": node("cert:one", "cert", "cert"),
            "d:one": node("d:one", "dns", "one.home"), "n:note": node("n:note", "note", "note"),
            "yt:one": node("yt:one", "video", "video"), "x:unknown": node("x:unknown", "app", "unknown"),
            "a:future": node("a:future", "app", "future"),
            "a:shared": node("a:shared", "app", "shared"), "h:shared": node("h:shared", "host", "shared"),
        }
        self.edges = [
            {"a": "h:one", "b": "a:one", "kind": "runs", "label": "runs app"},
            {"a": "h:one", "b": "a:two", "kind": "runs", "label": "runs app"},
            {"a": "ds:data", "b": "a:one", "kind": "member", "label": "mounted by"},
            {"a": "ds:data", "b": "a:two", "kind": "member", "label": "mounted by"},
            {"a": "px:one", "b": "a:one", "kind": "targets", "label": "proxies to"},
            {"a": "px:two", "b": "a:one", "kind": "targets", "label": "proxies to"},
            {"a": "h:one", "b": "h:vm", "kind": "runs", "label": "runs VM"},
            {"a": "cert:one", "b": "px:one", "kind": "covers", "label": "covers"},
            {"a": "cert:one", "b": "px:two", "kind": "covers", "label": "covers"},
            {"a": "d:one", "b": "h:one", "kind": "net", "label": "resolves to"},
            {"a": "a:chain1", "b": "a:chain2", "kind": "member", "label": "depends"},
            {"a": "a:chain2", "b": "a:chain3", "kind": "member", "label": "depends"},
            {"a": "a:chain3", "b": "a:chain4", "kind": "member", "label": "depends"},
            {"a": "a:chain4", "b": "a:chain5", "kind": "member", "label": "depends"},
            {"a": "a:chain5", "b": "x:unknown", "kind": "member", "label": "depends"},
            {"a": "a:one", "b": "n:note", "kind": "about", "label": "mentions"},
            {"a": "a:one", "b": "yt:one", "kind": "watched", "label": "watched"},
        ]
        graph._all = lambda F, live=False: (dict(self.nodes), list(self.edges))

    def tearDown(self):
        graph.fleet.get, graph._all, graph.common.DATA_DIR = self.get, self.all, self.data

    def test_same_name_prefers_a_node_with_dependents(self):
        self.nodes["svc:data"] = node("svc:data", "service", "data")      # a dashboard card: nothing depends on it
        data = graph.build("affected: data")
        self.assertEqual(data["affected"]["from"], "ds:data")
        self.assertEqual(data["affected"]["count"], 4)
        self.assertIn("4 proxy", search._count_words({"proxy": 4, "app": 1}))
        self.assertTrue(search._count_words({"proxy": 4, "app": 1}).startswith("4 proxy names"))

    def test_cap_keeps_deeper_hops_when_room(self):  # agy: hop-1 nodes were counted twice against CAP
        cap = graph.CAP
        try:
            graph.CAP = 6
            data = graph.build("affected: data")    # 2 apps (hop 1) + 2 proxies (hop 2) + start = 5 <= 6
            self.assertFalse(data["truncated"])
            self.assertEqual(len(data["nodes"]), 5)
        finally:
            graph.CAP = cap
        self.assertEqual(search.parse_affected("affected: host:data"), "data")

    def test_dependency_direction_and_exclusions(self):
        data = graph.build("affected: data")
        by_id = {n["id"]: n for n in data["nodes"]}
        self.assertIn("a:one", by_id)
        self.assertIn("a:two", by_id)
        self.assertIn("px:one", by_id)  # a proxy depends on its app
        self.assertIn("px:two", by_id)
        self.assertNotIn("cert:one", by_id)
        self.assertNotIn("h:one", by_id)  # an app outage does not take down its host
        self.assertNotIn("n:note", by_id)
        self.assertNotIn("yt:one", by_id)
        self.assertEqual(by_id["a:one"]["hop"], 1)
        self.assertEqual(by_id["px:one"]["hop"], 2)
        self.assertEqual(data["affected"]["by_kind"]["app"], 2)
        self.assertTrue({"px:one", "px:two"} <= {n["id"] for n in graph.build("affected: cert")["nodes"]})

    def test_depth_cap_unknown_edge_and_ambiguity(self):
        data = graph.build("impact: chain1")
        ids = {n["id"] for n in data["nodes"]}
        self.assertIn("a:chain5", ids)
        self.assertNotIn("x:unknown", ids)  # the fifth dependent is beyond four hops
        self.edges.append({"a": "a:chain1", "b": "a:future", "kind": "future", "label": "future"})
        self.assertNotIn("a:future", {n["id"] for n in graph.build("affected: chain1")["nodes"]})
        data = graph.build("affected: shared")
        self.assertTrue(any("matches 2 nodes" in w for w in data["warnings"]))

    def test_parse_and_search_summary(self):
        self.assertEqual(search.parse_affected("affected: babbage"), "babbage")
        self.assertEqual(search.parse_affected(" IMPACT : babbage "), "babbage")
        self.assertIsNone(search.parse_affected("affected:"))
        self.assertEqual(search.kind_of("impact: data"), "affected")
        result = search.search("affected: data", mode="full")
        group = result["groups"][0]
        self.assertEqual(group["source"], "affected")
        self.assertIn("If data goes down: 2 apps", group["items"][0]["title"])
        self.assertIn("hop 1 · via mounted by data", group["items"][1]["subtitle"])


if __name__ == "__main__":
    unittest.main()

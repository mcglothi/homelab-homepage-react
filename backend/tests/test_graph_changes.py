import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

os.environ["DATA_DIR"] = tempfile.mkdtemp()
sys.path.insert(0, "backend")

from homeapi import graph, search


def node(id, kind, label):
    return {"id": id, "kind": kind, "label": label, "sub": "", "attrs": []}


class GraphChangesTest(unittest.TestCase):
    def setUp(self):
        self.get, self.all, self.data, self.today = graph.fleet.get, graph._all, graph.common.DATA_DIR, graph._today
        graph.common.DATA_DIR = Path(tempfile.mkdtemp())
        graph._today = lambda: "2026-11-04"
        graph.fleet.get = lambda: {"ip_of": {}}
        self.nodes = {"h:context": node("h:context", "host", "context"), "h:new": node("h:new", "host", "new")}
        self.edges = [{"a": "h:context", "b": "h:new", "kind": "runs", "label": "runs"}]
        graph._all = lambda F, live=False: (dict(self.nodes), list(self.edges))

    def tearDown(self):
        graph.fleet.get, graph._all, graph.common.DATA_DIR, graph._today = self.get, self.all, self.data, self.today

    def write_old(self):
        folder = graph._snapshot_dir()
        folder.mkdir(parents=True)
        (folder / "2026-11-03.json").write_text(json.dumps({"nodes": {"h:context": ["host", "context"], "h:old": ["host", "old"]},
                                                              "edges": [["h:context", "h:old", "runs"]]}))

    def test_daily_write_once_and_prunes(self):
        graph._write_snapshot(self.nodes, self.edges)
        target = graph._snapshot_dir() / "2026-11-04.json"
        first = target.read_text()
        graph._write_snapshot({"h:later": node("h:later", "host", "later")}, [])
        self.assertEqual(target.read_text(), first)
        for day in range(1, 20):
            (graph._snapshot_dir() / ("2026-10-%02d.json" % day)).write_text("{}")
        graph._write_snapshot(self.nodes, self.edges)
        self.assertEqual(len(list(graph._snapshot_dir().glob("*.json"))), 14)

    def test_diff_uses_ghosts_and_search_summary(self):
        self.write_old()
        data = graph.build("changes:")
        changed = data["changes"]
        self.assertEqual(changed, {"since": "2026-11-03", "added": 1, "removed": 1, "edges_added": 1, "edges_removed": 1})
        by_id = {n["id"]: n for n in data["nodes"]}
        self.assertEqual(by_id["h:new"]["change"], "added")
        self.assertEqual(by_id["h:old"]["change"], "removed")
        self.assertTrue(by_id["h:old"]["missing"])
        self.assertEqual(by_id["h:old"]["sub"], "gone since 2026-11-03")
        self.assertTrue(any(e.get("flag") == "missing" and e["label"] == "was runs" for e in data["edges"]))
        result = search.search("what changed", mode="full")
        self.assertEqual(result["kind"], "changes")
        self.assertEqual(result["groups"][0]["source"], "changes")
        self.assertIn("Since 2026-11-03: +1 node, −1 node, +1 link, −1 link", result["groups"][0]["items"][0]["title"])

    def test_live_only_and_aikb_kinds_stay_out_of_snapshots(self):
        nodes = dict(self.nodes, **{"t:x": node("t:x", "target", "x"), "todo:1": node("todo:1", "pending", "p")})
        snap = graph._snapshot_nodes_edges(nodes, self.edges)
        self.assertEqual(sorted(snap["nodes"]), ["h:context", "h:new"])

    def test_review_fixes(self):  # agy review of the graphify-more branch
        self.write_old()
        # a new link between two nodes that both existed yesterday shows, with both ends
        self.nodes["h:old"] = node("h:old", "host", "old")
        self.edges += [{"a": "h:context", "b": "h:old", "kind": "runs", "label": "runs"},     # yesterday's link stays
                       {"a": "h:context", "b": "h:old", "kind": "member", "label": "has"}]
        del self.nodes["h:new"]
        self.edges = [e for e in self.edges if "h:new" not in (e["a"], e["b"])]
        data = graph.build("changes:")
        self.assertEqual(data["changes"]["edges_added"], 1)
        self.assertEqual({n["id"] for n in data["nodes"]}, {"h:context", "h:old"})
        self.assertTrue(any(e["kind"] == "member" for e in data["edges"]))
        # a removed node expands to nothing instead of a KeyError
        del self.nodes["h:old"]
        self.assertIn("no longer in the fleet", graph.build("x", expand="h:old")["warnings"][0])
        # alerts and certs churn: not in the snapshot
        snap = graph._snapshot_nodes_edges(dict(self.nodes, **{"al:x": node("al:x", "alert", "x"),
                                                                 "cert:x": node("cert:x", "cert", "x")}), [])
        self.assertEqual(sorted(snap["nodes"]), ["h:context"])
        # an empty mirror right after start is not the day's baseline
        graph._write_snapshot({}, [], today="2026-11-05")
        self.assertFalse((graph._snapshot_dir() / "2026-11-05.json").exists())
        # the fast (per-keystroke) search pass doesn't build the graph
        calls = []
        graph._all = lambda F, live=False: calls.append(1) or (dict(self.nodes), list(self.edges))
        self.assertEqual(search.search("changes:", mode="fast")["groups"], [])
        self.assertEqual(calls, [])

    def test_no_earlier_snapshot_and_unwritable_data_do_not_raise(self):
        data = graph.build("changed")
        self.assertEqual(data["nodes"], [])
        self.assertIn("no earlier snapshot yet; check back tomorrow", data["warnings"])
        bad = graph.common.DATA_DIR / "not-a-directory"
        bad.write_text("x")
        graph.common.DATA_DIR = bad
        graph._write_snapshot(self.nodes, self.edges)  # a warning is enough; graph requests stay alive


if __name__ == "__main__":
    unittest.main()

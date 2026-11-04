import os
import sys
import tempfile
import unittest

os.environ["DATA_DIR"] = tempfile.mkdtemp()
sys.path.insert(0, "backend")

from homeapi import graph, search
from homeapi.common import Cached


def video(id, title, channel, note=True):
    return {"id": id, "title": title, "channel": channel, "status": "kept", "reason": "AI tooling",
            "note_path": "media/youtube/2026/%s.md" % id if note else "None", "first_seen": "2026-11-04T06:18:05Z"}


class GraphWatchTest(unittest.TestCase):
    def setUp(self):
        self.videos, self.history, self.get, self.aikb = graph._videos, search.history, graph.fleet.get, graph._aikb
        self.alerts, self.state = graph._alerts, graph._state
        self.F = {"hosts": {"tesla": {"name": "tesla", "role": None, "ips": [], "via": [], "os": None, "state": None}},
                  "pools": {}, "datasets": {}, "apps": {}, "vms": {}, "proxies": {}, "dns": {}, "cards": [], "ip_of": {}}
        rows = [video("a1", "Graphify vs InfraNodus", "Nodus Labs"), video("a2", "InfraNodus deep dive", "Nodus Labs"),
                video("b1", "I went to Tesla's event", "Cars Weekly"), video("c1", "No note yet", "Solo", note=False),
                dict(video("x1", "Skipped clip", "Nodus Labs"), status="dropped"), dict(video("x2", "", "solo"))]
        graph._videos = Cached(600, lambda: rows)
        graph._alerts, graph._state = Cached(60, lambda: []), Cached(60, lambda: {})
        search.history = lambda: None
        graph.fleet.get, graph._aikb = lambda: self.F, lambda *a, **k: None

    def tearDown(self):
        graph._videos, search.history, graph.fleet.get, graph._aikb = self.videos, self.history, self.get, self.aikb
        graph._alerts, graph._state = self.alerts, self.state

    def test_videos_notes_and_channels(self):
        nodes, edges = graph._all(self.F)
        self.assertEqual(sorted(i for i, n in nodes.items() if n["kind"] == "video"), ["yt:a1", "yt:a2", "yt:b1", "yt:c1"])
        self.assertEqual([n["label"] for n in nodes.values() if n["kind"] == "channel"], ["Nodus Labs"])   # only channels with 2+
        kinds = {(e["a"], e["b"], e["kind"]) for e in edges}
        self.assertIn(("yt:a1", "n:media/youtube/2026/a1.md", "noted"), kinds)
        self.assertIn(("ch:nodus labs", "yt:a2", "published"), kinds)
        self.assertNotIn("n:None", nodes)
        self.assertFalse(any(e["a"] == "h:tesla" for e in edges))    # a host name in a title is not a link
        self.assertEqual(dict(nodes["yt:a1"]["attrs"])["Open"], "https://youtu.be/a1")

    def test_videos_seed_and_stay_out_of_fleet_searches(self):
        self.assertEqual(len(graph.build("videos")["seeds"]), 4)
        self.assertIn("yt:a1", graph.build("graphify")["seeds"])
        self.assertFalse(any(n["kind"] == "video" for n in graph.build("tesla")["nodes"]))

    def test_review_fixes(self):  # agy review of the watch branch
        nodes, _ = graph._all(self.F)
        self.assertNotIn("yt:x1", nodes)                                   # not kept
        self.assertEqual(nodes["ch:nodus labs"]["sub"], "2 kept videos")
        self.assertNotIn("ch:solo", nodes)                                 # the untitled row doesn't count
        data = graph.build("Graphify vs InfraNodus")                       # seeds the video and its note
        self.assertIn("yt:a2", {n["id"] for n in data["nodes"]})          # same channel, two hops

    def test_watch_down_is_not_an_error(self):
        graph._videos = Cached(600, lambda: (_ for _ in ()).throw(OSError("down")))
        nodes, _ = graph._all(self.F)
        self.assertFalse(any(n["kind"] == "video" for n in nodes.values()))


if __name__ == "__main__":
    unittest.main()

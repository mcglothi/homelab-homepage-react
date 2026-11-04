import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone

os.environ["DATA_DIR"] = tempfile.mkdtemp()
sys.path.insert(0, "backend")

from homeapi import graph, search
from homeapi.common import Cached


NOW = int(datetime.now(timezone.utc).timestamp())


def play(**extra):
    row = {"user": "tim", "friendly_name": "Tim", "user_id": "1", "player": "Apple TV", "platform": "tvOS", "product": "Plex for Apple TV",
           "media_type": "episode", "full_title": "Severance - Good News About Hell", "title": "Good News About Hell", "grandparent_title": "Severance",
           "rating_key": "101", "grandparent_rating_key": "50", "year": "2022", "date": str(NOW - 2 * 86400), "watched_status": "1", "duration": "3000"}
    row.update(extra)
    return row


class GraphMediaTest(unittest.TestCase):
    def setUp(self):
        self.history, self.movies, self.series = search.history, search._movies, search._series
        self.alerts, self.state, self.get, self.aikb = graph._alerts, graph._state, graph.fleet.get, graph._aikb
        self.F = {"hosts": {"turing": {"name": "turing", "role": "media", "ips": ["10.0.0.2"], "via": [], "os": None, "state": None}},
                  "pools": {}, "datasets": {}, "apps": {"plex": {"name": "plex", "host": "turing", "state": "RUNNING", "version": "1", "images": [], "ports": [], "update": False, "datasets": []}},
                  "vms": {}, "proxies": {}, "dns": {}, "cards": [], "ip_of": {}}
        self.rows = [
            play(),
            play(user="leslie", friendly_name="Leslie", user_id=2, player="Chrome", platform="Chrome", product="Plex Web", rating_key=102,
                 full_title="Severance - Half Loop", title="Half Loop", date=NOW - 86400),
            play(media_type="movie", title="The Missing", full_title="The Missing", grandparent_title="", rating_key="200", grandparent_rating_key="",
                 year="2025", player="Roku", platform="Roku", product="Plex for Roku", date=str(NOW - 3 * 86400)),
            play(media_type="track", title="Ignored song", full_title="Ignored song", grandparent_title="", rating_key="300", grandparent_rating_key=""),
        ]
        search.history = lambda: self.rows
        search._movies = lambda: [{"title": "The Missing", "year": 2025, "hasFile": False, "titleSlug": "the-missing"}]
        search._series = lambda: [{"title": "Severance", "year": 2022, "statistics": {"episodeFileCount": "2"}, "titleSlug": "severance"}]
        graph._alerts, graph._state = Cached(60, lambda: []), Cached(60, lambda: {})
        graph.fleet.get, graph._aikb = lambda: self.F, lambda *a, **k: None

    def tearDown(self):
        search.history, search._movies, search._series = self.history, self.movies, self.series
        graph._alerts, graph._state, graph.fleet.get, graph._aikb = self.alerts, self.state, self.get, self.aikb

    def test_nodes_edges_episode_fold_and_library(self):
        nodes, edges = graph._all(self.F)
        self.assertEqual({n["id"] for n in nodes.values() if n["kind"] == "title"}, {"t:50", "t:200"})
        self.assertEqual(nodes["t:50"]["label"], "Severance")
        self.assertEqual(dict(nodes["t:50"]["attrs"])["Last watched episode"], "Severance - Half Loop")
        self.assertEqual(dict(nodes["t:50"]["attrs"])["In library"], "on disk")
        self.assertEqual(dict(nodes["t:200"]["attrs"])["In library"], "missing")
        self.assertEqual(dict(nodes["t:200"]["attrs"])["Open"], "https://radarr.home.timmcg.net/movie/the-missing")
        self.assertEqual(len([n for n in nodes.values() if n["kind"] == "viewer"]), 2)
        self.assertEqual(len([n for n in nodes.values() if n["kind"] == "device"]), 3)
        self.assertNotIn("t:300", nodes)
        self.assertTrue(any(e["kind"] == "served_by" and e["b"] == "a:plex" for e in edges))
        self.assertTrue(all(e["prov"] == "extracted" for e in edges if e["kind"] in ("watched", "watches_on", "served_by")))

    def test_tautulli_response_shape_and_string_fields(self):
        old_cfg, old_tautulli = search.routes.cfg, search.routes.tautulli
        try:
            search.routes.cfg = lambda name, default="": "key" if name == "TAUTULLI_KEY" else default
            search.routes.tautulli = lambda cmd: (lambda: {"response": {"data": {"data": self.rows}}})
            self.assertEqual(len(search._tautulli_history()), 4)
        finally:
            search.routes.cfg, search.routes.tautulli = old_cfg, old_tautulli

    def test_title_cap_and_seeds(self):
        self.rows = [play(media_type="movie", title="Movie %s" % i, full_title="Movie %s" % i, grandparent_title="", rating_key=str(1000 + i),
                          grandparent_rating_key="", year="2025", date=str(NOW - i)) for i in range(61)]
        nodes, _ = graph._all(self.F)
        self.assertEqual(len([n for n in nodes.values() if n["kind"] == "title"]), 60)
        self.assertEqual(len(graph._seeds("watched", nodes)), 60)
        self.assertEqual(graph._seeds("Tim", nodes), ["u:1"])

    def test_media_stays_one_hop_from_fleet_seeds(self):
        kinds = lambda q: {n["kind"] for n in graph.build(q)["nodes"]}
        self.assertFalse(kinds("turing") & {"viewer", "device", "title"})   # turing -> plex -> titles is two hops
        self.assertIn("title", kinds("plex"))                                # plex itself lists what was watched
        self.assertEqual({n["kind"] for n in graph.build("media:")["nodes"] if n["result"]}, {"title"})
        self.assertIn("viewer", kinds("media:"))
        self.assertEqual(graph.build("media: leslie")["seeds"], [i for i, n in graph._all(self.F)[0].items() if n["label"] == "Leslie"])

    def test_tautulli_down_warns_without_breaking_graph(self):
        search.history = lambda: (_ for _ in ()).throw(OSError("down"))
        data = graph.build("")
        self.assertFalse(any(n["kind"] in ("viewer", "device", "title") for n in data["nodes"]))
        self.assertEqual(data["warnings"], ["Tautulli is unavailable, so media activity is left out"])
        search.history = lambda: None  # no key is the same empty-media graph state
        self.assertEqual(graph.build("")["warnings"], ["Tautulli is unavailable, so media activity is left out"])

    def test_search_group_and_empty_media_scope(self):
        group = search._plex_history("severance")
        self.assertEqual(group["title"], "Plex history")
        self.assertEqual(group["items"][0]["title"], "Severance")
        self.assertIn("watched by Leslie, Tim", group["items"][0]["subtitle"])
        self.assertEqual(search._plex_history("leslie")["items"][0]["title"], "Leslie")
        data = search.search("media:", mode="full")
        self.assertEqual(data["scope"], "media")
        self.assertEqual(data["groups"][0]["title"], "Plex history")


if __name__ == "__main__":
    unittest.main()

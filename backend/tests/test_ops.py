import os
import sys
import tempfile
import unittest

os.environ["DATA_DIR"] = tempfile.mkdtemp()
sys.path.insert(0, "backend")

from homeapi import graph, search
from homeapi.common import Cached


class OpsGraphTest(unittest.TestCase):
    def setUp(self):
        self.fetch, self.alerts, self.state = graph.fetch_local, graph._alerts, graph._state
        self.F = {"hosts": {"turing": {"name": "turing", "ips": ["10.0.0.50"], "via": [], "role": None, "os": None},
                            "nas": {"name": "nas", "ips": [], "via": [], "role": None, "os": None}}, "ip_of": {"10.0.0.50": "turing"},
                  "pools": {}, "datasets": {}, "apps": {"plex": {"name": "plex", "host": "turing", "state": "RUNNING", "version": "1", "images": [], "ports": [], "update": False, "datasets": []}},
                  "vms": {}, "proxies": {"plex.home.timmcg.net": {"name": "plex.home.timmcg.net", "aliases": ["*.home.timmcg.net"], "npm_id": 7,
                                                                  "cert_expires": "2026-11-08T00:00:00Z", "upstream": "10.0.0.50", "port": 80,
                                                                  "scheme": "http", "enabled": True, "host": "turing", "app": "plex"}},
                  "dns": {}, "cards": [{"name": "Plex", "group": "Media", "desc": "streaming", "href": "https://plex.home.timmcg.net", "proxy": "plex.home.timmcg.net"}]}
        self.urls = []
        def fake(url, **_):
            self.urls.append(url)
            if url.endswith("/api/v1/targets"):
                return {"data": {"activeTargets": []}}
            if url.endswith("/api/v1/alerts"):
                return {"data": {"alerts": [{"labels": {"alertname": "DiskFull", "instance": "10.0.0.50:9100", "severity": "critical", "job": "node"},
                                                "annotations": {"summary": "disk full", "description": "turing disk"}, "state": "firing", "activeAt": "2026-11-04T00:00:00Z"}]}}
            if url.endswith("/state"):
                return {"ssl_certs": [{"name": "*.home.timmcg.net", "npm_cert_id": 7, "expires": "2026-11-08T00:00:00Z", "warn_after": "21", "file": "ops/certs.md"}],
                        "open_incidents": [{"item": "Repair turing", "detail": "Disk alert on turing", "priority": "critical", "project": "lab", "file": "ops/incident.md"}],
                        "pending": [{"item": "Review truenas", "detail": "truenas only", "priority": "low", "project": "lab"}]}
            return None
        graph.fetch_local = fake
        graph._alerts, graph._state = Cached(60, graph._ops_alerts), Cached(60, graph._ops_state)

    def tearDown(self):
        graph.fetch_local, graph._alerts, graph._state = self.fetch, self.alerts, self.state

    def test_live_nodes_group_and_join(self):
        nodes, edges = graph._all(self.F)
        self.assertIn("al:DiskFull|10.0.0.50:9100", nodes)
        self.assertTrue(nodes["al:DiskFull|10.0.0.50:9100"]["missing"])
        self.assertIn(("h:turing", "al:DiskFull|10.0.0.50:9100", "alerts"), {(e["a"], e["b"], e["kind"]) for e in edges})
        certs = [n for n in nodes.values() if n["kind"] == "cert"]
        self.assertEqual(len(certs), 1)
        self.assertEqual(dict(certs[0]["attrs"])["Warn after"], "21")
        self.assertTrue(any(e["kind"] == "covers" for e in edges))
        incident = next(n for n in nodes.values() if n["kind"] == "incident")
        self.assertIn("Open", dict(incident["attrs"]))
        mentions = {(e["a"], e["kind"], e["prov"]) for e in edges}
        self.assertIn(("h:turing", "about", "inferred"), mentions)
        self.assertNotIn(("h:nas", "about", "inferred"), mentions)  # nas is not a word in truenas
        self.assertIn("n:ops/incident.md", nodes)
        self.assertTrue(any(u.endswith("/api/v1/alerts") for u in self.urls))

    def test_proxies_sharing_a_certificate_make_one_cert_node(self):
        base = self.F["proxies"]["plex.home.timmcg.net"]
        self.F["proxies"] = {n: dict(base, name=n, aliases=[], npm_id=i, cert_id=1, cert_name="*.home.timmcg.net")
                             for i, n in enumerate(["plex.home.timmcg.net", "nas.home.timmcg.net", "dns.home.timmcg.net"])}
        self.F["proxies"]["plain.home.timmcg.net"] = dict(base, name="plain.home.timmcg.net", aliases=[], npm_id=9, cert_expires=None)
        nodes, edges = graph._all(self.F)
        certs = [n for n in nodes.values() if n["kind"] == "cert"]
        self.assertEqual([c["label"] for c in certs], ["*.home.timmcg.net"])
        self.assertEqual(sum(1 for e in edges if e["kind"] == "covers"), 3)

    def test_npm_domain_names_given_as_a_json_string(self):
        from homeapi.sources import npm
        self.assertEqual(npm._names('["a.home.timmcg.net", "b.home.timmcg.net"]'), ["a.home.timmcg.net", "b.home.timmcg.net"])
        self.assertEqual(npm._names("solo.home.timmcg.net"), ["solo.home.timmcg.net"])
        self.assertEqual(npm._names(None), [])

    def test_ops_seeds(self):
        nodes, _ = graph._all(self.F, live=True)
        self.assertEqual(graph._seeds("certificates", nodes), [n["id"] for n in nodes.values() if n["kind"] == "cert"])


class OpsSearchTest(unittest.TestCase):
    def setUp(self):
        self.fetch, self.fleet_get = search.fetch_local, search.fleet.get
        self.alerts, self.state = search._ops_alert_cache, search._ops_state_cache
        search.fleet.get = lambda: {"hosts": {}, "apps": {}, "cards": [], "datasets": {}, "pools": {}, "dns": {},
                                    "proxies": {"plex.home.timmcg.net": {"name": "plex.home.timmcg.net", "aliases": [], "npm_id": 7, "cert_expires": "2026-11-08T00:00:00Z"}}}
        def fake(url, **_):
            if "/alerts" in url:
                return {"data": {"alerts": [{"labels": {"alertname": "DiskFull", "host": "turing", "severity": "critical"}, "annotations": {"summary": "disk"}, "state": "firing", "activeAt": "2026-11-04T00:00:00Z"}]}}
            return {"open_incidents": [{"item": "Repair turing", "priority": "high", "project": "lab", "file": "ops/incident.md"}], "pending": []}
        search.fetch_local = fake
        search._ops_alert_cache, search._ops_state_cache = Cached(60, search._prom_alerts), Cached(60, search._aikb_state)

    def tearDown(self):
        search.fetch_local, search.fleet.get = self.fetch, self.fleet_get
        search._ops_alert_cache, search._ops_state_cache = self.alerts, self.state

    def test_ops_source_and_scope(self):
        group = search._ops("turing")
        self.assertEqual(group["source"], "ops")
        self.assertEqual(group["items"][0]["status"], "failed")
        data = search.search("ops:", mode="full")
        self.assertEqual(data["scope"], "ops")
        self.assertEqual(data["groups"][0]["source"], "ops")
        self.assertEqual(search.parse_scope("alerts: disk"), ("ops", "disk"))


if __name__ == "__main__":
    unittest.main()

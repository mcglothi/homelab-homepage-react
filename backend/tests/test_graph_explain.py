import os
import sys
import tempfile
import unittest

os.environ["DATA_DIR"] = tempfile.mkdtemp()
sys.path.insert(0, "backend")

from homeapi import graph


class Base(unittest.TestCase):
    def setUp(self):
        self.request = graph.request
        graph._model_cache.update(at=0.0, id=None)
        graph._names_cache.clear()

    def tearDown(self):
        graph.request = self.request


class ExplainTest(Base):
    def test_hopper_request_and_response(self):
        seen = {}
        class Response:
            status = 200
            json = {"choices": [{"message": {"content": "Useful finding."}}]}
        def fake(url, **kwargs):
            seen.update(url=url, **kwargs)
            return Response()
        graph.request = fake
        status, body = graph.explain({"summary": {"question": "what connects this?", "relationships": ["turing --runs--> plex"]}})
        self.assertEqual(status, 200)
        self.assertEqual((body["text"], body["backend"]), ("Useful finding.", "hopper"))
        self.assertEqual(seen["timeout"], 150)
        self.assertEqual(seen["body"]["chat_template_kwargs"], {"enable_thinking": False})
        self.assertTrue(seen["body"]["messages"][1]["content"].startswith("/no_think\n"))

    def test_bad_and_empty_responses(self):
        self.assertEqual(graph.explain({})[0], 400)
        class Response:
            status = 200
            json = {"choices": [{"message": {"content": ""}}]}
        graph.request = lambda *args, **kwargs: Response()
        self.assertEqual(graph.explain({"summary": {}})[0], 504)



def fake_server(models, reply, seen):
    """request() stand-in: GET /v1/models lists `models`; POST answers `reply`."""
    class R:
        def __init__(self, status, js):
            self.status, self.json = status, js
    def fake(url, method="GET", body=None, timeout=None, **kwargs):
        if method == "GET":
            seen.setdefault("gets", []).append(url)
            return R(200, {"data": [{"id": m} for m in models]})
        seen.setdefault("posts", []).append(body)
        return R(200, {"choices": [{"message": {"content": reply}}]})
    return fake


class ModelTest(Base):
    def test_uses_whichever_model_hopper_has_loaded(self):
        seen = {}
        graph.request = fake_server(["qwen-next-9000"], "ok", seen)
        status, body = graph.explain({"summary": {"question": "q"}})
        self.assertEqual((status, body["model"]), (200, "qwen-next-9000"))
        self.assertEqual(seen["posts"][0]["model"], "qwen-next-9000")
        self.assertTrue(seen["gets"][0].endswith("/v1/models"))

    def test_falls_back_to_configured_name_when_list_fails(self):
        def broken(url, method="GET", **kwargs):
            if method == "GET":
                raise OSError("down")
            class R:
                status, json = 200, {"choices": [{"message": {"content": "ok"}}]}
            return R()
        graph.request = broken
        self.assertEqual(graph.explain({"summary": {"question": "q"}})[1]["model"], "nemotron-3.5-lightning")


class NamesTest(Base):
    def test_names_parse_and_cache_by_members(self):
        seen = {}
        graph.request = fake_server(["m"], "1: Backup storage\n2: Media apps", seen)
        body = {"clusters": [{"names": ["zfs", "snapshots", "backups"]}, {"names": ["plex", "sonarr"]}]}
        status, out = graph.cluster_names(body)
        self.assertEqual(status, 200)
        self.assertEqual(sorted(out["names"].values()), ["Backup storage", "Media apps"])
        self.assertEqual(out["by_index"], {0: "Backup storage", 1: "Media apps"})
        # same members in another order (a renumbered community): served from cache, no second model call
        status, again = graph.cluster_names({"clusters": [{"names": ["backups", "zfs", "snapshots"]}]})
        self.assertEqual(list(again["names"].values()), ["Backup storage"])
        self.assertEqual(len(seen["posts"]), 1)

    def test_names_need_clusters(self):
        self.assertEqual(graph.cluster_names({})[0], 400)


class AskTest(Base):
    def test_answer_and_only_known_node_ids(self):
        seen = {}
        graph.request = fake_server(["m"], "Plex runs on Turing.\nNODES: h:turing, a:plex, h:invented", seen)
        status, out = graph.ask({"question": "where does plex run?", "nodes": [{"id": "h:turing", "label": "turing"}, {"id": "a:plex", "label": "plex"}],
                                 "edges": [["h:turing", "a:plex", "runs"], ["h:turing", "h:ghost", "x"]]})
        self.assertEqual(status, 200)
        self.assertEqual(out["text"], "Plex runs on Turing.")
        self.assertEqual(out["ids"], ["h:turing", "a:plex"])
        prompt = seen["posts"][0]["messages"][1]["content"]
        self.assertIn("h:turing --runs--> a:plex", prompt)
        self.assertNotIn("h:ghost", prompt)   # links to nodes not on screen are dropped

    def test_ask_needs_question_and_nodes(self):
        self.assertEqual(graph.ask({"question": "x"})[0], 400)


if __name__ == "__main__":
    unittest.main()

import os
import sys
import tempfile
import unittest

os.environ["DATA_DIR"] = tempfile.mkdtemp()
sys.path.insert(0, "backend")

from homeapi import graph


class ExplainTest(unittest.TestCase):
    def setUp(self):
        self.request = graph.request

    def tearDown(self):
        graph.request = self.request

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


if __name__ == "__main__":
    unittest.main()

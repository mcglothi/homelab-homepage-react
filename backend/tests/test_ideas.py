import os
import sys
import tempfile
import unittest
from datetime import date

os.environ["DATA_DIR"] = tempfile.mkdtemp()
sys.path.insert(0, "backend")

from homeapi import ideas

REPORT = """---
tags: [ideas, shortlist, generated]
---

# Idea shortlist 2026-11-11
**Summary:** 3 ideas.

## 1. Account for behind-the-meter generation \\[solar\\]
**Score:** 28/30 (O4 F4 I5 fit5) · **id:** `90b7b95b49ee`

Detail text.

- **From:** [Solar \\(and\\) the grid](<https://www.youtube.com/watch?v=x&t=1s>) · Chan · 2026-11-10 ([note](<../../media/x.md>))
- [x] Worth acting on

## 2. A thing Tim has
**Score:** 20/30 (O3 F3 I3 fit4) · ⚠️ looks built: `personal-projects/watch.md` · **id:** `aaaaaaaaaaaa`

- **From:** blurt capture · 2026-11-09 ([note](<../../ideas/inbox/a.md>))
- [ ] Worth acting on

## 3. Not scored
**Score:** unscored · **id:** `bbbbbbbbbbbb`

- [ ] Worth acting on
"""


class IdeasTest(unittest.TestCase):
    def test_parse(self):
        got = ideas.parse(REPORT, "ideas/shortlist/2026-11-11.md")
        self.assertEqual((got["date"], got["count"], got["ticked"]), ("2026-11-11", 3, 1))
        a, b, c = got["items"]
        self.assertEqual(a["title"], "Account for behind-the-meter generation [solar]")
        self.assertEqual((a["score"], a["built"], a["ticked"], a["id"]), (28, False, True, "90b7b95b49ee"))
        self.assertEqual(a["from"], "Solar (and) the grid")
        self.assertEqual((b["built"], b["from"]), (True, "blurt capture"))
        self.assertEqual((c["score"], c["ticked"]), (None, False))
        self.assertEqual(got["href"], "/aikb/note?path=ideas%2Fshortlist%2F2026-11-11.md")

    def test_latest_picks_newest_day_and_last_rerun(self):
        files = {"ideas/shortlist/2026-11-09.md": "## 1. old\n", "ideas/shortlist/2026-11-10.md": "## 1. first\n",
                 "ideas/shortlist/2026-11-10-2.md": "## 1. second\n## 2. more\n"}
        asked = []

        def fetch(url, timeout=5):
            path = url.split("path=", 1)[1].replace("%2F", "/")
            asked.append(path)
            return {"content": files[path]} if path in files else {"error": "note not found"}

        got = ideas.latest(date(2026, 11, 11), fetch)
        self.assertEqual((got["path"], got["count"]), ("ideas/shortlist/2026-11-10-2.md", 2))
        self.assertNotIn("ideas/shortlist/2026-11-09.md", asked)

    def test_nothing_in_two_weeks(self):
        got = ideas.latest(date(2026, 11, 11), lambda url, timeout=5: {"error": "note not found"})
        self.assertEqual((got["count"], got["items"]), (0, []))


if __name__ == "__main__":
    unittest.main()

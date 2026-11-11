"""The latest idea shortlist from AIKB (ideas/shortlist/<date>.md, written by AIKB's _tools/idea-shortlist).

Read-only: the report comes through the AIKB facade's /note (Turing's read-only mirror), so it shows up here once the
report is committed to AIKB. Tim ticks "Worth acting on" in the AIKB file itself; this only reads the ticks back.
"""

import re
from datetime import date, timedelta
from urllib.parse import quote

from .common import Cached, fetch_local
from . import routes

DIR = "ideas/shortlist/"
LOOKBACK_DAYS = 14
_UNESCAPE = re.compile(r"\\([\\`*_{}\[\]<>()#+!|~])")   # the report escapes Markdown in untrusted text
_HEAD = re.compile(r"^## (\d+)\. (.+)$")
_SCORE = re.compile(r"^\*\*Score:\*\* (?:(\d+)/30|unscored)(.*?)· \*\*id:\*\* `([0-9a-f]+)`")
_FROM = re.compile(r"^- \*\*From:\*\* (?:\[(.+?)\]\(<[^>]*>\)|(.+?))(?: · | \(\[note\]|$)")


def plain(text):
    return _UNESCAPE.sub(r"\1", text).strip()


def parse(content, path):
    """The report's ideas: rank, title, weighted score (or None), looks-built flag, ticked box, where it came from."""
    items, cur = [], None
    for line in content.splitlines():
        m = _HEAD.match(line)
        if m:
            cur = {"rank": int(m.group(1)), "title": plain(m.group(2)), "score": None, "built": False, "ticked": False,
                   "from": "", "id": ""}
            items.append(cur)
            continue
        if cur is None:
            continue
        m = _SCORE.match(line)
        if m:
            cur["score"] = int(m.group(1)) if m.group(1) else None
            cur["built"] = "looks built" in m.group(2)
            cur["id"] = m.group(3)
        elif line.startswith("- **From:**"):
            f = _FROM.match(line)
            cur["from"] = plain((f.group(1) or f.group(2)) if f else "")
        elif line.startswith("- [x] Worth acting on") or line.startswith("- [X] Worth acting on"):
            cur["ticked"] = True
    stamp = re.search(r"(\d{4}-\d{2}-\d{2}(?:-\d+)?)\.md$", path)
    return {"path": path, "date": stamp.group(1) if stamp else "", "href": "/aikb/note?path=" + quote(path, safe=""),
            "count": len(items), "ticked": sum(1 for i in items if i["ticked"]), "items": items}


def _note(path, fetch):
    data = fetch(routes.AIKB_SEARCH_URL() + "/note?path=" + quote(path, safe=""), timeout=8)
    return data.get("content") if isinstance(data, dict) and isinstance(data.get("content"), str) else None


def latest(today=None, fetch=fetch_local):
    """Newest report in the last two weeks; on a day with reruns (-2, -3 ...) the last one."""
    today = today or date.today()
    for back in range(LOOKBACK_DAYS + 1):
        day = (today - timedelta(days=back)).isoformat()
        content = _note(DIR + day + ".md", fetch)
        if content is None:
            continue
        path, n = DIR + day + ".md", 2
        while n < 20:
            more = _note("%s%s-%d.md" % (DIR, day, n), fetch)
            if more is None:
                break
            content, path, n = more, "%s%s-%d.md" % (DIR, day, n), n + 1
        return parse(content, path)
    return {"path": "", "date": "", "href": "", "count": 0, "ticked": 0, "items": []}


get = Cached(600, latest)

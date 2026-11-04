#!/usr/bin/env python3
"""Compare the Python server with the live Node proxy, route by route.

The route list is read from server/proxy.cjs (not from the Python routes), so a route
the port forgot shows up as a failure. Compares status code and the shape of the JSON
(top-level keys and value types), not values. GET only: never sends the media-sweep
toggle anywhere.

    python3 backend/tests/parity.py http://localhost:3099 https://www.home.timmcg.net
"""

import json
import re
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path

PROXY = Path(__file__).resolve().parents[2] / "server" / "proxy.cjs"
# Concrete paths for the wildcard routes (the ones the front end calls).
WILDCARDS = {"/api/watch/*": "/api/watch/status", "/api/aikb/*": "/api/aikb/health", "/api/usage/*": "/api/usage/summary"}
CTX = ssl.create_default_context()
CTX.check_hostname, CTX.verify_mode = False, ssl.CERT_NONE


def routes():
    out = []
    for p in re.findall(r"app\.get\('(/api/[^']+)'", PROXY.read_text()):
        out.append(WILDCARDS.get(p, p))
    return out


def fetch(base, path):
    try:
        with urllib.request.urlopen(base + path, timeout=40, context=CTX) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:  # noqa: BLE001
        return None, str(e).encode()


def shape(raw):
    try:
        d = json.loads(raw)
    except ValueError:
        return "not json"
    if isinstance(d, dict):
        return {k: type(v).__name__ for k, v in d.items()}
    if isinstance(d, list):
        return "list[%s]" % (type(d[0]).__name__ if d else "")
    return type(d).__name__


def main(new, old):
    fails = 0
    for path in routes():
        (s1, b1), (s2, b2) = fetch(new, path), fetch(old, path)
        sh1, sh2 = shape(b1), shape(b2)
        # Keys only: a value that is null on one side and a number on the other is timing, not shape.
        same_keys = (sh1.keys() == sh2.keys()) if isinstance(sh1, dict) and isinstance(sh2, dict) else sh1 == sh2
        ok = s1 == s2 and same_keys
        fails += not ok
        print("%s %-28s new=%s old=%s" % ("ok  " if ok else "FAIL", path, s1, s2))
        if not ok:
            print("      new: %s\n      old: %s" % (str(sh1)[:300], str(sh2)[:300]))
    print("\n%d routes, %d failed" % (len(routes()), fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1].rstrip("/"), sys.argv[2].rstrip("/")))

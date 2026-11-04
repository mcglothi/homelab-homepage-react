"""/api/auth: is every integration's credential set and accepted, and where to fix it.

Two kinds of provider:
  * collectors (TrueNAS, NPM, AdGuard, Headscale) — read from the mirror's last run,
    no extra upstream calls; a run older than three collect intervals is a yellow
  * keyed services (Plex, Sonarr, ...) — one cheap authenticated GET each, cached
Nothing here can log in for you (no SSO flows at home), so every fix is "manual":
where the value comes from, shown so it can be copied.
"""

import time

from . import mirror, routes
from .common import UpstreamError, parallel, request, setting

STALE_RUNS = 3
SECRETS = "Bitwarden item (BW_ITEMS in backend/homeapi/common.py), or the key in .env"


def _fix(keys, item=None):
    where = ("Bitwarden: %s" % item) if item else ".env: %s" % ", ".join(keys)
    return {"kind": "manual", "label": "where it's set", "command": where,
            "help": "Set %s (%s), then redeploy or restart the container." % (" + ".join(keys), SECRETS)}


COLLECTORS = [
    ("truenas", "TrueNAS", _fix(["TRUENAS_API_KEY"], "PAT/TrueNAS/svc_claude")),
    ("npm", "Nginx Proxy Manager", _fix(["NPM_USER", "NPM_PASSWORD"], "PAT/NPM/svc_claude")),
    ("adguard", "AdGuard", _fix(["ADGUARD_USER", "ADGUARD_PASSWORD"])),
    ("headscale", "Headscale", _fix(["HEADSCALE_API_KEY"], "PAT/Headscale/api-docket")),
]


def _ago(t):
    m = int((time.time() - t) // 60)
    return "just now" if m < 1 else "%dm ago" % m if m < 120 else "%dh ago" % (m // 60)


def _collector(cid, name, fix, runs):
    out = {"id": cid, "name": name, "fix": fix, "expires": None, "fixing": False}
    r = runs.get(cid)
    if not r:
        return dict(out, state="warn", detail="not collected yet")
    if r.get("error"):
        err = r["error"]
        auth = any(s in err.lower() for s in ("401", "403", "unauthori", "forbidden", "not configured", "invalid"))
        return dict(out, state="error" if auth else "warn", detail=err if auth else "unreachable: " + err)
    interval = float(setting("COLLECT_MINUTES", "15")) * 60
    if interval and time.time() - r["at"] > STALE_RUNS * interval:
        return dict(out, state="warn", detail="last collected %s" % _ago(r["at"]))
    return dict(out, state="ok", detail="%d items · %s" % (r["count"], _ago(r["at"])))


# (id, name, key setting, url(key) -> (url, headers), rejected(json) -> bool, detail when ok)
KEYED = [
    ("plex", "Plex", "PLEX_TOKEN", lambda k: (routes.PLEX_URL() + "/library/sections", {"X-Plex-Token": k}), None,
     # Plex answers the LAN without any token (tested: bogus and none both get 200), so this can't check it
     "reachable · LAN needs no token, so the token isn't tested"),
    ("tautulli", "Tautulli", "TAUTULLI_KEY",
     lambda k: (routes.TAUTULLI_URL() + "/api/v2?cmd=arnold&apikey=" + k, {}),
     lambda j: ((j or {}).get("response") or {}).get("result") != "success", None),
    ("sonarr", "Sonarr", "SONARR_KEY", lambda k: (routes.SONARR_URL() + "/api/v3/system/status", {"X-Api-Key": k}), None, None),
    ("radarr", "Radarr", "RADARR_KEY", lambda k: (routes.RADARR_URL() + "/api/v3/system/status", {"X-Api-Key": k}), None, None),
    ("overseerr", "Overseerr", "OVERSEERR_KEY",
     lambda k: (routes.OVERSEERR_URL() + "/api/v1/settings/main", {"X-Api-Key": k}), None, None),
    ("sabnzbd", "SABnzbd", "SABNZBD_KEY",
     # mode=version answers any key; mode=queue checks it (403 when wrong)
     lambda k: (routes.SABNZBD_URL() + "/api?mode=queue&output=json&limit=1&apikey=" + k, {}),
     lambda j: (j or {}).get("status") is False, None),
]


def _keyed(pid, name, key, target, rejected, ok_detail):
    out = {"id": pid, "name": name, "fix": _fix([key]), "expires": None, "fixing": False}
    k = setting(key, "")
    if not k:
        return dict(out, state="error", detail="%s not set" % key)
    url, headers = target(k)
    try:
        res = request(url, headers=headers, timeout=6)
    except UpstreamError as e:
        return dict(out, state="warn", detail="unreachable: %s" % e)
    if res.status in (401, 403) or (rejected and rejected(res.json)):
        return dict(out, state="error", detail="key rejected (HTTP %s)" % res.status)
    if res.status >= 400:
        return dict(out, state="warn", detail="HTTP %s" % res.status)
    return dict(out, state="ok", detail=ok_detail or "connected")


def _fetch():
    runs = mirror.runs()
    rows = [_collector(c, n, f, runs) for c, n, f in COLLECTORS]
    rows += parallel(*[(lambda p=p: _keyed(*p)) for p in KEYED])
    worst = "error" if any(r["state"] == "error" for r in rows) else \
            "warn" if any(r["state"] == "warn" for r in rows) else "ok"
    return {"overall": worst, "providers": rows, "checked": time.time()}


_cache = {}


def get():
    """The last check if it's under 30s old, else a new one."""
    if time.time() - _cache.get("at", 0) > 30:
        refresh()
    return _cache["data"]


def refresh():
    _cache.update(data=_fetch(), at=time.time())
    return _cache["data"]

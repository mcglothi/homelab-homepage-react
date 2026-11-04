"""/api/search?q=…&mode=fast|full and /api/search/stream — one search box across the homelab.
Same contract as the work Docket's search (its front end runs unchanged on it).

  fast — the mirror only (hosts, apps, datasets, pools, proxy names, DNS, dashboard cards);
         safe on every keystroke.
  full — fast plus live lookups chosen by what the query looks like (kind_of):
           host / ip → Prometheus targets and firing alerts on it
           anything  → Radarr movies, Sonarr series, the watch ledger, AIKB notes and operations state
Each live source fails on its own: an error becomes a note, never a blank result.

Groups: {source, title, items: [{title, subtitle, detail?, href?, search?, status?, children?}]}.
"""

import re
import threading
import time
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

from . import fleet, routes
from .common import Cached, fetch_local, js_quote

PER_GROUP = 25
SCOPE_PREFIX = re.compile(r"^(host|hosts|h|app|apps|media|m|aikb|kb|notes|ops|alerts)\s*:\s*(.*)$", re.I)
SCOPE_OF = {"host": "hosts", "hosts": "hosts", "h": "hosts", "app": "apps", "apps": "apps", "media": "media", "m": "media", "aikb": "aikb", "kb": "aikb", "notes": "aikb", "ops": "ops", "alerts": "ops"}
SCOPE_TAGS = {"hosts": {"host", "dns", "network", "vm", "servers"}, "apps": {"app", "service", "proxy", "dataset"},
              "media": {"media", "watch"}, "aikb": {"aikb"}, "ops": set()}
SCOPE_SOURCES = {"hosts": {"Prometheus"}, "apps": {"Prometheus"}, "media": {"Radarr", "Sonarr", "Watch"}, "aikb": {"AIKB"}, "ops": {"Ops"}}


def parse_path(q):
    """Two endpoints from `a .. b`, or the explicit `path: a -> b` / `path: a to b` forms."""
    text = (q or "").strip()
    m = re.match(r"^path\s*:\s*(.+?)\s*(?:->|\bto\b|\.\.)\s*(.+?)$", text, re.I)
    if not m:
        # bare form needs spaces, so IP ranges and v1..v2 stay ordinary searches
        m = re.match(r"^(.+?)\s+(?:\.\.|->)\s+(.+?)$", text)
    if not m:
        return None
    # "host:babbage .. turing": a scope prefix on an end just names the end
    a, b = (re.sub(r"^(?:host|kb)\s*:\s*", "", g.strip(), flags=re.I) for g in m.groups())
    return (a, b) if a and b else None


def kind_of(q):
    if parse_path(q):
        return "path"
    t = q.strip().lower()
    F = fleet.get()
    if fleet.is_ip(t):
        return "ip"
    if fleet.short(t) in F["hosts"]:
        return "host"
    if t in F["apps"]:
        return "app"
    return "text"


def parse_scope(q, scope=None):
    m = SCOPE_PREFIX.match((q or "").strip())
    if m:
        return SCOPE_OF[m.group(1).lower()], m.group(2).strip()
    return (scope if scope in SCOPE_TAGS else None), (q or "").strip()


def _hit(q, *fields):
    t = q.lower()
    return any(t in str(f).lower() for f in fields if f)


def _gb(n):
    return "%.1f GB" % (n / 1e9) if n else ""


def _host_item(h):
    return {"title": h["name"], "subtitle": " · ".join(filter(None, [", ".join(h["ips"]), h.get("role") or ", ".join(h["via"])])),
            "search": h["name"]}


def fast(q):
    if parse_path(q):
        return []
    F = fleet.get()
    groups = []

    def group(source, title, items):
        if items:
            groups.append({"source": source, "title": title, "items": items[:PER_GROUP],
                           **({"more": len(items) - PER_GROUP} if len(items) > PER_GROUP else {})})

    group("host", "Hosts", [_host_item(h) for h in F["hosts"].values() if _hit(q, h["name"], *h["ips"])])
    group("app", "TrueNAS apps", [{
        "title": a["name"], "subtitle": " · ".join(filter(None, [a.get("state"), a.get("version"), "on " + a["host"] if a.get("host") else ""])),
        "detail": ", ".join(a.get("images") or []), "status": "ok" if a.get("state") == "RUNNING" else "failed", "search": a["name"]}
        for a in F["apps"].values() if _hit(q, a["name"], *(a.get("images") or []))])
    group("service", "Dashboard cards", [{
        "title": c["name"], "subtitle": "%s · %s" % (c["group"], c["desc"]), "href": c["href"]}
        for c in F["cards"] if _hit(q, c["name"], c["desc"], c["hostname"])])
    group("proxy", "Proxy hosts (NPM)", [{
        "title": p["name"], "subtitle": "→ %s:%s%s" % (p.get("upstream"), p.get("port"), " (%s)" % p["app"] if p.get("app") else ""),
        "href": "https://" + p["name"], "status": None if p.get("enabled") else "canceled"}
        for p in F["proxies"].values() if _hit(q, p["name"], p.get("upstream"), p.get("app"), p.get("host"))])
    group("dns", "DNS rewrites (AdGuard)", [{"title": d["name"], "subtitle": "→ %s" % d.get("answer")}
                                             for d in F["dns"].values() if _hit(q, d["name"], d.get("answer"))])
    group("dataset", "Datasets", [{
        "title": d["name"], "subtitle": " · ".join(filter(None, [d.get("mountpoint"), _gb(d.get("used"))]))}
        for d in F["datasets"].values() if _hit(q, d["name"], d.get("mountpoint"))])
    group("pool", "Pools", [{"title": p["name"], "subtitle": "%s on %s" % (p.get("status"), p.get("host")),
                             "status": "ok" if p.get("status") == "ONLINE" else "failed"}
                            for p in F["pools"].values() if _hit(q, p["name"])])
    return groups


# ── Live sources ─────────────────────────────────────────────────────────────

def _prom_targets():
    return (fetch_local(routes.PROMETHEUS_URL() + "/api/v1/targets") or {}).get("data", {}).get("activeTargets") or []


def _prom_alerts():
    return (fetch_local(routes.PROMETHEUS_URL() + "/api/v1/alerts") or {}).get("data", {}).get("alerts") or []


def _aikb_state():
    return fetch_local(routes.AIKB_SEARCH_URL() + "/state", timeout=12) or {}


_ops_alert_cache = Cached(60, _prom_alerts)
_ops_state_cache = Cached(60, _aikb_state)


def _ops_days(expires):
    try:
        stamp = str(expires).replace("Z", "+00:00")
        when = datetime.fromisoformat(stamp)
        when = when.replace(tzinfo=timezone.utc) if when.tzinfo is None else when
        return int((when - datetime.now(timezone.utc)).total_seconds() // 86400)
    except (TypeError, ValueError):
        return None


def _ops_match(q, *values):
    return not q or _hit(q, *values)


def _ops_item(raw):
    raw = raw if isinstance(raw, dict) else {"item": raw}
    return {"item": str(raw.get("item") or raw.get("title") or raw.get("name") or "Untitled"),
            "detail": raw.get("detail") or raw.get("description") or raw.get("summary"), "priority": raw.get("priority"),
            "project": raw.get("project"), "file": raw.get("file"), "blocked_by": raw.get("blocked_by")}


def _ops(q):
    """The small, urgent slice of live data; a blank ops: query deliberately shows all of it."""
    F = fleet.get()
    try:
        alerts = _ops_alert_cache()
    except Exception:  # noqa: BLE001 - state trouble must not hide firing alerts
        alerts = []
    try:
        state = _ops_state_cache()
    except Exception:  # noqa: BLE001 - Prometheus trouble must not hide AIKB work
        state = {}
    rows = []
    for alert in alerts:
        labels, annotations = alert.get("labels") or {}, alert.get("annotations") or {}
        if alert.get("state") != "firing" or not _ops_match(q, *labels.values(), *annotations.values()):
            continue
        severity = str(labels.get("severity") or "alert")
        level = 0 if severity.lower() in ("critical", "page", "fatal") else 1
        host = labels.get("host") or labels.get("instance") or labels.get("job")
        rows.append((level, {"title": labels.get("alertname") or "Alert",
                             "subtitle": " · ".join(filter(None, [severity, host, ("since " + alert["activeAt"][:16]) if alert.get("activeAt") else None])),
                             "detail": annotations.get("summary") or annotations.get("description"), "status": "failed" if level == 0 else "open"}))
    from . import graph  # graph imports search, so keep this local
    certs = graph.certificates(F, state)
    for cert in certs.values():
        names, days = sorted(cert["names"]), _ops_days(cert["expires"])
        if days is None or days >= 30 or not _ops_match(q, *names, cert.get("label"), cert["expires"]):
            continue
        level = 0 if days < 7 else 1
        rows.append((level, {"title": cert.get("label") or names[0], "subtitle": "certificate · %s days left" % days,
                             "detail": "%s name%s covered" % (len(names), "" if len(names) == 1 else "s"), "status": "failed" if level == 0 else "open"}))
    for kind, values in (("incident", state.get("open_incidents") or []), ("pending", state.get("pending") or [])):
        for raw in values:
            item = _ops_item(raw)
            if not _ops_match(q, item["item"], item["detail"], item["project"], item["blocked_by"], item["priority"]):
                continue
            priority = str(item["priority"] or kind)
            urgent = priority.lower() in ("critical", "p0", "high")
            # an open incident is live trouble; a to-do, however high, ranks below it
            level = (0 if urgent else 1) if kind == "incident" else (1 if urgent else 2 if priority.lower() in ("warning", "p1", "medium") else 3)
            rows.append((level, {"title": item["item"], "subtitle": " · ".join(filter(None, [priority, item["project"]])),
                                "detail": item["detail"], "status": "failed" if level == 0 else "open",
                                **({"href": "/aikb/note?path=" + js_quote(item["file"]), "internal": True} if item["file"] else {})}))
    # within a level, live trouble (alerts, certs) before AIKB work items; rows were appended in that order
    items = [row for _, _, row in sorted(((lv, n, r) for n, (lv, r) in enumerate(rows)), key=lambda t: (t[0], t[1]))]
    return {"source": "ops", "title": "Ops", "items": items[:PER_GROUP]} if items else None


def _prometheus(q):
    F = fleet.get()
    h = F["hosts"].get(fleet.short(q))
    keys = {q.lower()} | ({h["name"]} | set(h["ips"]) if h else set())

    def mine(s):
        s = str(s).lower()
        return any(k and k in s for k in keys)
    t_items = [{"title": "%s · %s" % (t.get("labels", {}).get("job"), t.get("labels", {}).get("instance")),
                "subtitle": "%s · last scrape %s" % (t.get("health"), (t.get("lastScrape") or "")[:19]),
                "status": "ok" if t.get("health") == "up" else "failed", "href": t.get("scrapeUrl")}
               for t in _prom_targets() if mine(t.get("labels", {}).get("instance")) or mine(t.get("labels", {}).get("job"))]
    a_items = [{"title": a.get("labels", {}).get("alertname"), "subtitle": "%s · since %s" % (a.get("state"), (a.get("activeAt") or "")[:16]),
                "detail": (a.get("annotations") or {}).get("summary"), "status": "failed" if a.get("state") == "firing" else "open"}
               for a in _ops_alert_cache() if any(mine(v) for v in (a.get("labels") or {}).values())]
    out = []
    if a_items:
        out.append({"source": "health", "title": "Prometheus alerts", "items": a_items})
    if t_items:
        out.append({"source": "health", "title": "Prometheus targets", "items": t_items[:PER_GROUP]})
    return out


_movies = Cached(300, lambda: fetch_local("%s/api/v3/movie?apikey=%s" % (routes.RADARR_URL(), routes.cfg("RADARR_KEY", "")), timeout=20) or [])
_series = Cached(300, lambda: fetch_local("%s/api/v3/series?apikey=%s" % (routes.SONARR_URL(), routes.cfg("SONARR_KEY", "")), timeout=20) or [])


def _radarr(q):
    items = [{"title": "%s (%s)" % (m.get("title"), m.get("year")),
              "subtitle": " · ".join(filter(None, ["on disk" if m.get("hasFile") else "missing",
                                                   ((m.get("movieFile") or {}).get("quality") or {}).get("quality", {}).get("name"),
                                                   _gb(m.get("sizeOnDisk"))])),
              "detail": (m.get("movieFile") or {}).get("relativePath"), "status": "ok" if m.get("hasFile") else "open",
              "href": "https://radarr.home.timmcg.net/movie/%s" % m.get("titleSlug")}
             for m in _movies() if _hit(q, m.get("title"), m.get("originalTitle"))]
    return {"source": "media", "title": "Movies (Radarr)", "items": items[:PER_GROUP]} if items else None


def _sonarr(q):
    items = [{"title": "%s (%s)" % (s.get("title"), s.get("year")),
              "subtitle": "%s · %s episodes on disk" % (s.get("status"), (s.get("statistics") or {}).get("episodeFileCount")),
              "href": "https://sonarr.home.timmcg.net/series/%s" % s.get("titleSlug")}
             for s in _series() if _hit(q, s.get("title"))]
    return {"source": "media", "title": "TV (Sonarr)", "items": items[:PER_GROUP]} if items else None


def _watch(q):
    rows = fetch_local("%s/api/watch/find?q=%s" % (routes.WATCH_URL(), js_quote(q)), timeout=15) or []
    items = [{"title": r.get("title"), "subtitle": " · ".join(filter(None, [r.get("channel"), r.get("status")])),
              "detail": r.get("snippet") or r.get("snip"), "href": "https://youtu.be/%s" % r.get("id")} for r in rows if isinstance(r, dict)]
    return {"source": "watch", "title": "Watched videos", "items": items[:PER_GROUP]} if items else None


def _aikb(q):
    rows = (fetch_local("%s/search?q=%s&k=10" % (routes.AIKB_SEARCH_URL(), js_quote(q)), timeout=15) or {}).get("results") or []
    items = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        title, section = r.get("title") or r.get("file") or "Untitled", r.get("section") or "overview"
        detail = re.sub(r"\s+", " ", re.sub(r"^\s*#{1,6}\s*", "", r.get("excerpt") or "")).strip()
        # A click on a host row searches for it (the host's own results and graph)
        children = [{"title": e.get("name"), "subtitle": "host", "search": "host:" + e["name"]} for e in (r.get("entities") or [])
                    if isinstance(e, dict) and e.get("kind") == "host" and e.get("name")][:4]
        items.append({"title": title if section == "overview" else "%s · %s" % (title, section),
                      "subtitle": " · ".join(filter(None, [r.get("file"), r.get("date")])), "detail": detail,
                      "href": "/aikb/note?path=%s&section=%s" % (js_quote(r.get("file") or ""), js_quote(section)),
                      "internal": True, **({"children": children} if children else {})})
    return {"source": "aikb", "title": "AIKB notes", "items": items} if items else None


def plan(q, scope=None):
    if parse_path(q):
        return "path", None, [("Path", lambda: _path(q))]
    kind = kind_of(q)
    sources = []
    if kind in ("host", "ip", "app"):
        sources.append(("Prometheus", lambda: _prometheus(q)))
    if len(q) >= 3:
        sources += [("Radarr", lambda: _radarr(q)), ("Sonarr", lambda: _sonarr(q)), ("Watch", lambda: _watch(q)), ("AIKB", lambda: _aikb(q))]
    if len(q) >= 3 or scope == "ops":
        sources.append(("Ops", lambda: _ops(q)))
    resolved = fleet.short(q) if kind == "host" else None
    return kind, resolved, sources


def _groups_of(res):
    return [g for g in (res if isinstance(res, list) else [res]) if g]


def _path(q):
    """The graph owns path resolution, notes and provenance; search only renders its routes."""
    from . import graph  # graph imports parse_path above, so keep this local
    data = graph.build(q)
    by_id = {n["id"]: n for n in data.get("nodes") or []}
    by_hop = {}
    for e in sorted(data.get("edges") or [], key=lambda e: graph.PROV_RANK.get(e.get("prov"), 9)):
        by_hop.setdefault((e.get("a"), e.get("b")), e)  # parallel hops: show the best-sourced one
    items = []
    for route in (data.get("path") or {}).get("routes") or []:
        ids = route.get("ids") or []
        labels = [by_id.get(i, {}).get("label", i) for i in ids]
        # Two nodes with one name in a route (the Containers pool and dataset) get their kind
        labels = [("%s (%s)" % (l, by_id.get(i, {}).get("kind")) if labels.count(l) > 1 else l) for l, i in zip(labels, ids)]
        detail = []
        for a, b in zip(ids, ids[1:]):
            e = by_hop.get((a, b)) or by_hop.get((b, a)) or {}
            detail.append("%s —%s→ %s (%s, %s)" % (by_id.get(a, {}).get("label", a), e.get("label", e.get("kind", "links to")),
                                                        by_id.get(b, {}).get("label", b), e.get("via") or "graph", e.get("prov", "extracted")))
        items.append({"title": " → ".join(labels), "subtitle": "%s hop%s · %s" % (route.get("hops", 0), "" if route.get("hops", 0) == 1 else "s", route.get("confidence", "extracted")),
                      "detail": "\n".join(detail)})
    ends = parse_path(q) or ("", "")
    return {"source": "path", "title": "How %s connects to %s" % ends, "items": items} if items else None


def _scoped(scope, kind, resolved, sources, groups):
    if not scope or kind == "path":
        return sources, groups
    return [(n, f) for n, f in sources if n in SCOPE_SOURCES[scope]], [g for g in groups if g["source"] in SCOPE_TAGS[scope]]


_full_cache = {}
_full_lock = threading.Lock()
FULL_TTL = 60


def search(q, mode="fast", scope=None):
    scope, q = parse_scope(q, scope)
    if len(q) < 2 and scope != "ops":
        return {"q": q, "kind": None, "groups": []}
    if parse_path(q):
        groups = _groups_of(_path(q))
        return {"q": q, "asked": q, "kind": "path", "resolved": None, "mode": mode, "scope": scope, "groups": groups}
    kind, resolved, sources = plan(q, scope)
    sources, local = _scoped(scope, kind, resolved, sources, fast(q))
    if mode != "full":
        return {"q": q, "asked": q, "kind": kind, "resolved": resolved, "mode": "fast", "scope": scope, "groups": local}
    groups = []
    for _, fn in sources:
        try:
            groups += _groups_of(fn())
        except Exception as e:  # noqa: BLE001
            groups.append({"source": "error", "title": "Error", "error": str(e), "items": []})
    return {"q": q, "asked": q, "kind": kind, "resolved": resolved, "mode": "full", "scope": scope, "groups": groups + local}


def stream(q, scope=None):
    """The full search as events, each source's groups as soon as it answers:
      {"type": "start", q, asked, kind, sources: [names]}
      {"type": "source", name, groups, error?, seconds}   one per source, as each finishes
      {"type": "done", groups: [local mirror matches]}
    A cached result replays at once, so a repeat search looks finished immediately."""
    scope, q = parse_scope(q, scope)
    if len(q) < 2 and scope != "ops":
        yield {"type": "done", "groups": []}
        return
    key = "%s:%s" % (scope, q.lower())
    with _full_lock:
        hit = _full_cache.get(key)
    if hit and time.time() - hit[0] < FULL_TTL:
        r = hit[1]
        yield {"type": "start", "q": q, "asked": q, "kind": r["kind"], "resolved": r["resolved"], "sources": ["cached"], "cached": True}
        yield {"type": "source", "name": "cached", "groups": r["live"], "seconds": 0}
        yield {"type": "done", "groups": r["local"]}
        return
    kind, resolved, sources = plan(q, scope)
    sources, local = _scoped(scope, kind, resolved, sources, fast(q))
    yield {"type": "start", "q": q, "asked": q, "kind": kind, "resolved": resolved, "sources": [n for n, _ in sources]}
    got = {}
    if sources:
        with ThreadPoolExecutor(max_workers=len(sources)) as pool:
            t0 = time.time()
            futures = {pool.submit(fn): name for name, fn in sources}
            for f in as_completed(futures):
                name = futures[f]
                try:
                    groups, err = _groups_of(f.result()), None
                except Exception as e:  # noqa: BLE001 - one source failing must not sink the rest
                    groups, err = [], str(e) or type(e).__name__
                got[name] = groups
                yield {"type": "source", "name": name, "groups": groups, "error": err, "seconds": round(time.time() - t0, 1)}
    live = [g for name, _ in sources for g in got.get(name, [])]
    with _full_lock:
        _full_cache[key] = (time.time(), {"kind": kind, "resolved": resolved, "live": live, "local": local})
    yield {"type": "done", "groups": local}

"""/api/graph — the relationship graph behind the search Graph view, as {nodes, edges}.
Same contract as the work Docket's graph (its Graph front end runs on it). Built from the
mirror (fleet.py) plus cached operations state; ?live=1 adds Prometheus targets.

Every edge runs parent (a) -> child (b). The chains:
    host -> pool -> dataset -> child dataset ; dataset -> app that mounts it
    host -> app it runs ; host -> VM (a VM is a host of its own)
    proxy name -> app or host it forwards to ; DNS name -> host it resolves to
    dashboard card -> proxy name in its link ; monitoring target -> host it scrapes
Edge flags: "inferred" (an app matched by its default port, not a published one),
"missing" (a proxy forwarding to an address no host claims), "derived" (joined by IP).

Node ids: h: host, pl: pool, ds: dataset, a: app, px: proxy name, d: DNS name, svc: card,
ip: an address with no host, t: monitoring target or media title, u: Plex viewer, dev: playback device,
n: an AIKB note, q: the search.
AIKB notes join last: host/app/card -> each note that mentions it (AIKB_SEARCH_URL /mentions),
only for the start nodes (or the node being expanded), so the graph stays readable. A text search
also starts from the notes AIKB finds for it (/search), joined to the fleet nodes they name
(/links); `kb:` searches start from notes only. Expanding a note adds what it names.
"""

from collections import defaultdict, deque
from datetime import datetime, timezone
import hashlib
import json
import logging
import os
import re
import threading
from urllib.parse import quote, urlencode, urlsplit

from . import fleet, routes, search
from . import common
from .common import Cached, fetch_local, parallel, request, settle

CAP = 400      # nodes per graph; `truncated` says when it bites
DEPTH = 2      # hops from the start nodes
NOTE_LOOKUPS = 6   # hosts/apps asked about per graph
NOTES_EACH = 5     # notes per host/app
NOTE_SEEDS = 8     # notes a text search starts from

# Which end depends on the other. Add a new fleet dependency kind here once.
# `monitor` (host -> scrape target) is left out: targets exist only on ?live=1 builds, so counts would jump.
DEPENDS = {"member": "b", "runs": "b", "covers": "b",
           "targets": "a", "net": "a", "named": "a"}
# Not fleet things: they never go down, so they don't start a blast radius
NOT_FLEET = {"note", "concept", "media", "viewer", "device", "title", "video", "channel", "query", "incident", "pending"}
# Also kept out of the daily snapshot: targets are live-only, alerts fire and clear, certs merge AIKB /state
# (gone when AIKB times out) and renew; any of them would show as fake changes
SNAPSHOT_SKIP = NOT_FLEET | {"target", "alert", "cert"}
_snapshot_lock = threading.Lock()
SNAPSHOT_DAYS = 14
_log = logging.getLogger(__name__)


def _ops_alerts():
    return (fetch_local(routes.PROMETHEUS_URL() + "/api/v1/alerts", timeout=8) or {}).get("data", {}).get("alerts") or []


def _ops_state():
    return fetch_local(routes.AIKB_SEARCH_URL() + "/state", timeout=8) or {}


_alerts = Cached(60, _ops_alerts)
_state = Cached(60, _ops_state)
_media_state = threading.local()


def _days_left(expires):
    try:
        stamp = str(expires).replace("Z", "+00:00")
        when = datetime.fromisoformat(stamp)
        when = when.replace(tzinfo=timezone.utc) if when.tzinfo is None else when  # naive stamps are UTC
        return int((when - datetime.now(timezone.utc)).total_seconds() // 86400)
    except (TypeError, ValueError):
        return None


def _cert_parent(name):
    labels = (name or "").lower().lstrip("*.").split(".")
    return ".".join(labels[-3:]) if len(labels) >= 3 else (name or "").lower()


def _cert_groups(F):
    """NPM gives one mirror row per name; collapse those aliases back to their certificate."""
    groups = {}
    for proxy in F["proxies"].values():
        expires = proxy.get("cert_expires")
        if not expires and not proxy.get("cert_id"):
            continue  # plain-HTTP proxy: no certificate to show
        # cert_id is NPM's certificate id (npm_id is the proxy's); older mirror rows lack it
        key = str(proxy["cert_id"]) if proxy.get("cert_id") else "%s|%s" % (expires or "", _cert_parent(proxy["name"]))
        cert = groups.setdefault(key, {"key": key, "npm_id": proxy.get("cert_id"), "expires": expires, "names": set(), "label": proxy.get("cert_name")})
        cert["expires"], cert["label"] = cert["expires"] or expires, cert["label"] or proxy.get("cert_name")
        cert["names"].add(proxy["name"])
        cert["names"].update(proxy.get("aliases") or [])
    return groups


def certificates(F, state):
    """NPM certificates merged with AIKB's _state.yaml ssl_certs; shared by the graph and the Ops search source."""
    certs = _cert_groups(F)
    for s in state.get("ssl_certs") or []:
        if not isinstance(s, dict):
            continue
        sid, name = s.get("npm_cert_id"), str(s.get("name") or "")
        if sid is None and not name:
            continue
        cert = next((c for c in certs.values() if sid is not None and str(c.get("npm_id")) == str(sid)), None)
        # a stale id in the state file still merges when the name matches
        cert = cert or next((c for c in certs.values() if name and name.lower() in {n.lower() for n in c["names"] | {c.get("label") or ""}}), None)
        key = cert["key"] if cert else (str(sid) if sid is not None else name.lower())
        cert = certs.setdefault(key, {"key": key, "npm_id": sid, "expires": s.get("expires"), "names": set(), "label": name or None})
        if name and name != cert.get("label"):
            cert["names"].add(name)
        cert["expires"] = cert.get("expires") or s.get("expires")
        cert["warn_after"], cert["file"] = s.get("warn_after"), s.get("file")
    return certs


def _warn_days(warn_after):
    try:
        return int(warn_after)
    except (TypeError, ValueError):
        return 21


def _ops_item_id(prefix, item):
    return "%s:%s" % (prefix, hashlib.sha1(str(item).encode()).hexdigest()[:10])


def _item_fields(value):
    value = value if isinstance(value, dict) else {"item": value}
    return {"item": str(value.get("item") or value.get("title") or value.get("name") or "Untitled"),
            "detail": value.get("detail") or value.get("description") or value.get("summary"),
            "blocked_by": value.get("blocked_by"), "priority": value.get("priority"),
            "project": value.get("project"), "file": value.get("file")}


_videos = Cached(600, lambda: [v for v in fetch_local(routes.WATCH_URL() + "/api/watch/recent?status=kept&limit=200", timeout=10) or [] if isinstance(v, dict)])


def _whole_word_mentions(text, label):
    return bool(label and re.search(r"(?<!\w)%s(?!\w)" % re.escape(label), text, re.I))


def _provenance(kind, flag=None, via=None):
    """One policy for every graph edge, including future edge kinds."""
    if flag in ("missing", "ambiguous"):
        return "ambiguous"
    if flag in ("inferred", "derived") or kind == "cooccur" or via == "AIKB inferred":
        return "inferred"
    return "extracted"


def _with_provenance(edges):
    return [dict(e, prov=_provenance(e.get("kind"), e.get("flag"), e.get("via"))) for e in edges]


def _gb(n):
    return "%.1f GB" % (n / 1e9) if n else "—"


def _all(F, live=False):
    """Every node and edge the mirror knows (a few hundred), keyed by id."""
    nodes, edges, eseen = {}, [], set()
    _media_state.warning = False

    def node(id, kind, label, sub="", attrs=None, **extra):
        nodes.setdefault(id, {"id": id, "kind": kind, "label": label, "sub": sub, "attrs": attrs or [], **extra})
        return id

    def edge(a, b, kind, label, flag=None, via=None, detail=None):
        if a in nodes and b in nodes and (a, b, kind) not in eseen:
            eseen.add((a, b, kind))
            edges.append({"a": a, "b": b, "kind": kind, "label": label, "flag": flag, "detail": detail, "via": via,
                          "prov": _provenance(kind, flag, via)})

    for h in F["hosts"].values():
        node("h:" + h["name"], "host", h["name"], h.get("role") or ", ".join(h["ips"]),
             [["IP", ", ".join(h["ips"]) or "—"], ["Seen in", ", ".join(h["via"])]] + ([["OS", h["os"]]] if h.get("os") else [])
             + ([["VM state", h["state"]]] if h.get("state") else []))
    for p in F["pools"].values():
        node("pl:" + p["name"], "pool", p["name"], "ZFS pool · %s" % p.get("status"), [["Status", p.get("status")], ["Source", "TrueNAS"]],
             missing=p.get("status") != "ONLINE")
        edge("h:" + p["host"], "pl:" + p["name"], "member", "has pool", via="TrueNAS")
    for d in F["datasets"].values():
        node("ds:" + d["name"], "dataset", d["name"].rsplit("/", 1)[-1], d.get("mountpoint") or "",
             [["Dataset", d["name"]], ["Mountpoint", d.get("mountpoint") or "—"], ["Used", _gb(d.get("used"))], ["Source", "TrueNAS"]])
    for d in F["datasets"].values():
        parent = "ds:" + d["parent"] if d.get("parent") else "pl:" + d["pool"]
        edge(parent, "ds:" + d["name"], "member", "contains", via="TrueNAS")
    for a in F["apps"].values():
        node("a:" + a["name"], "app", a["name"], "%s · %s" % (a.get("state"), a.get("version")),
             [["State", a.get("state")], ["Version", a.get("version")], ["Images", ", ".join(a.get("images") or []) or "—"],
              ["Ports", ", ".join(map(str, a.get("ports") or [])) or "host network"], ["Update available", "yes" if a.get("update") else "no"],
              ["Source", "TrueNAS apps"]], missing=a.get("state") != "RUNNING")
        edge("h:" + a["host"], "a:" + a["name"], "runs", "runs app", via="TrueNAS")
        for ds in a.get("datasets") or []:
            edge("ds:" + ds, "a:" + a["name"], "member", "mounted by", via="TrueNAS app volumes")
    for v in F["vms"].values():
        edge("h:" + v["host"], "h:" + v["name"], "runs", "runs VM", via="TrueNAS VMs")
    for p in F["proxies"].values():
        node("px:" + p["name"], "proxy", p["name"], "→ %s:%s" % (p.get("upstream"), p.get("port")),
             [["Forwards to", "%s://%s:%s" % (p.get("scheme"), p.get("upstream"), p.get("port"))], ["Enabled", "yes" if p.get("enabled") else "no"],
              ["Cert expires", (p.get("cert_expires") or "—")[:10]], ["Other names", ", ".join(p.get("aliases") or []) or "—"], ["Source", "Nginx Proxy Manager"]],
             missing=not p.get("enabled"))
        if p.get("app"):
            published = p["port"] in (F["apps"][p["app"]].get("ports") or [])
            edge("px:" + p["name"], "a:" + p["app"], "targets", "proxies to", flag=None if published else "inferred", via="NPM",
                 detail=None if published else "matched on the app's default port %s" % p["port"])
        elif p.get("host"):
            edge("px:" + p["name"], "h:" + p["host"], "net", "proxies to", flag="derived", via="NPM", detail="joined by IP %s" % p.get("upstream"))
        elif p.get("upstream"):
            ipid = node("ip:" + p["upstream"], "network", p["upstream"], "no host claims this address", [["Address", p["upstream"]]])
            edge("px:" + p["name"], ipid, "net", "proxies to", flag="missing", via="NPM")
    for d in F["dns"].values():
        ans = d.get("answer")
        node("d:" + d["name"], "dns", d["name"], "→ %s" % ans, [["Answer", ans], ["Source", "AdGuard rewrite"]])
        hk = F["ip_of"].get(ans)
        if hk:
            edge("d:" + d["name"], "h:" + hk, "net", "resolves to", via="AdGuard")
    for c in F["cards"]:
        node("svc:" + c["name"], "service", c["name"], "%s card · %s" % (c["group"], c["desc"]), [["Link", c["href"]], ["Section", c["group"]]])
        if c.get("proxy"):
            edge("svc:" + c["name"], "px:" + c["proxy"], "named", "links to", via="services.js")
    if live:
        try:
            targets = (fetch_local(routes.PROMETHEUS_URL() + "/api/v1/targets", timeout=8) or {}).get("data", {}).get("activeTargets") or []
        except Exception:  # noqa: BLE001 - the graph without targets is still the graph
            targets = []
        for t in targets:
            lab = t.get("labels") or {}
            inst = lab.get("instance") or ""
            hostpart = urlsplit("//" + inst).hostname or inst
            hk = F["ip_of"].get(hostpart) or (fleet.short(hostpart) if fleet.short(hostpart) in F["hosts"] else None)
            if not hk:
                continue
            tid = node("t:%s|%s" % (lab.get("job"), inst), "target", "%s · %s" % (lab.get("job"), inst.split(":")[-1]), t.get("health") or "",
                       [["Job", lab.get("job")], ["Instance", inst], ["Health", t.get("health")], ["Last scrape", (t.get("lastScrape") or "")[:19]],
                        ["Source", "Prometheus"]], missing=t.get("health") != "up")
            edge("h:" + hk, tid, "monitor", "scraped by", via="Prometheus")
    alerts, state = parallel(lambda: settle(_alerts), lambda: settle(_state))
    alerts, state = alerts or [], state or {}
    for alert in alerts:
        labels, annotations = alert.get("labels") or {}, alert.get("annotations") or {}
        name, instance = labels.get("alertname") or "Alert", labels.get("instance") or ""
        # alertname+instance isn't unique (DiskFull per mountpoint, host-only alerts)
        where = "|".join(filter(None, [instance or labels.get("host")] + [labels.get(k) for k in ("mountpoint", "device", "name")]))
        since = (alert.get("activeAt") or "")[:16]
        aid = node("al:%s|%s" % (name, where), "alert", name,
                   " · ".join(filter(None, [labels.get("severity"), alert.get("state"), "since " + since if since else None])),
                   [["Summary", annotations.get("summary") or "—"], ["Description", annotations.get("description") or "—"],
                    ["Instance", instance or "—"], ["Job", labels.get("job") or "—"], ["Source", "Prometheus"]],
                   missing=alert.get("state") == "firing")
        hostpart = urlsplit(instance if "://" in instance else "//" + instance).hostname or instance.split(":", 1)[0]
        host = (labels.get("host") or "").rsplit(":", 1)[0] if (labels.get("host") or "").count(":") == 1 else labels.get("host")
        hk = (F["ip_of"].get(host) or (fleet.short(host) if fleet.short(host) in F["hosts"] else None)) if host else None
        hk = hk or F["ip_of"].get(hostpart) or (fleet.short(hostpart) if fleet.short(hostpart) in F["hosts"] else None)
        if hk:
            edge("h:" + hk, aid, "alerts", "is alerting", via="Prometheus")
    certs = certificates(F, state)
    for cert in certs.values():
        names, expires = sorted(cert["names"]), cert.get("expires")
        days = _days_left(expires)
        attrs = [["Expires", expires or "—"], ["Days left", str(days) if days is not None else "—"],
                 ["Names covered", "%s: %s" % (len(names), ", ".join(names[:4]))], ["Source", "Nginx Proxy Manager"]]
        if cert.get("warn_after") is not None:
            attrs.append(["Warn after", str(cert["warn_after"])])
        if cert.get("file"):
            attrs.append(["Open", "/aikb/note?path=" + quote(str(cert["file"]), safe="")])
        cid = node("cert:" + cert["key"], "cert", cert.get("label") or (names[0] if names else "Certificate"),
                   "expires in %s days" % days if days is not None else "expiry unknown", attrs,
                   missing=days is not None and days < _warn_days(cert.get("warn_after")))
        for name in names:
            edge(cid, "px:" + name, "covers", "covers", via="NPM")
    for prefix, kind, values in (("inc", "incident", state.get("open_incidents") or []), ("todo", "pending", state.get("pending") or [])):
        for raw in values:
            item = _item_fields(raw)
            iid = node(_ops_item_id(prefix, item["item"] + "\n" + str(item["detail"] or "")), kind, item["item"][:60],
                       " · ".join(filter(None, [str(item["priority"]) if item["priority"] else None, str(item["project"]) if item["project"] else None])),
                       [["Detail", item["detail"] or "—"], ["Blocked by", item["blocked_by"] or "—"]]
                       + ([["Open", "/aikb/note?path=" + quote(str(item["file"]), safe="")]] if item["file"] else []))
            text = " ".join(str(item[k] or "") for k in ("item", "detail"))
            for fid, candidate in nodes.copy().items():
                if candidate["kind"] in ("host", "app", "service") and _whole_word_mentions(text, candidate["label"]):
                    edge(fid, iid, "about", "mentioned in", via="AIKB inferred")
            if item["file"]:
                nid = "n:" + str(item["file"])
                node(nid, "note", str(item["file"]).rsplit("/", 1)[-1][:-3], str(item["file"]),
                     [["File", str(item["file"])], ["Open", "/aikb/note?path=" + quote(str(item["file"]), safe="")], ["Source", "AIKB"]])
                edge(iid, nid, "about", "mentioned in", via="AIKB")
    # Kept YouTube videos from the watch ledger: each links to its AIKB note and to its channel when that
    # channel has several. No fleet edges: of 200 titles none named an app, and host names (tesla, newton)
    # are ordinary words, so title matching only made false links.
    videos = [v for v in settle(_videos) or [] if v.get("id") and v.get("title") and v.get("status", "kept") == "kept"]
    by_channel = defaultdict(list)
    for v in videos:
        by_channel[(v.get("channel") or "").lower()].append(v)
    for v in videos:
        note = v.get("note_path") if str(v.get("note_path") or "").endswith(".md") else None
        vid = node("yt:" + v["id"], "video", v["title"], " · ".join(filter(None, [v.get("channel"), (v.get("first_seen") or "")[:10]])),
                   [["Channel", v.get("channel") or "—"], ["Why kept", (v.get("reason") or "—")[:300]], ["Open", "https://youtu.be/" + v["id"]]]
                   + ([["Notes", "/aikb/note?path=" + quote(note, safe="")]] if note else []))
        if note:
            nodes.setdefault("n:" + note, _note(note, v["title"]))
            edge(vid, "n:" + note, "noted", "noted in", via="Watch")
        if v.get("channel") and len(by_channel[v["channel"].lower()]) > 1:
            cid = node("ch:" + v["channel"].lower(), "channel", v["channel"], _n(len(by_channel[v["channel"].lower()]), "kept video"))
            edge(cid, vid, "published", "published", via="Watch")
    try:
        history = search.history()
    except Exception:  # noqa: BLE001 - Tautulli is optional
        history = None
    if history is None:
        _media_state.warning = True
        return nodes, edges
    movies = settle(search._movies) or []
    series = settle(search._series) or []

    def number(value):
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return 0

    def watched(value):
        try:
            return datetime.fromtimestamp(float(value), timezone.utc) if float(value) > 0 else None  # 0 = no date
        except (TypeError, ValueError, OSError, OverflowError):
            return None

    def ago(when):
        if not when:
            return "unknown"
        days = max(0, int((datetime.now(timezone.utc) - when).total_seconds() // 86400))
        return "today" if not days else "%sd" % days

    def library(title, year, media_type):
        values = movies if media_type == "movie" else series
        for item in values:
            if str(item.get("title") or "").lower() != title.lower():
                continue
            # a show's episode row carries the episode's air year, not the series' premiere year
            if media_type == "movie" and year and str(item.get("year") or "") != str(year):
                continue
            if media_type == "movie":
                return ("on disk" if item.get("hasFile") else "missing", "https://radarr.home.timmcg.net/movie/%s" % item.get("titleSlug"))
            return ("on disk" if number((item.get("statistics") or {}).get("episodeFileCount")) else "missing",
                    "https://sonarr.home.timmcg.net/series/%s" % item.get("titleSlug"))
        return None

    titles, viewers, devices, plays = {}, {}, {}, []
    for row in history:
        if not isinstance(row, dict):
            continue
        media_type = str(row.get("media_type") or "").lower()
        if media_type == "track" or media_type not in ("movie", "episode"):
            continue
        title = str((row.get("grandparent_title") if media_type == "episode" else row.get("title")) or row.get("full_title") or "").strip()
        rating = str((row.get("grandparent_rating_key") if media_type == "episode" else row.get("rating_key")) or row.get("rating_key") or "").strip()
        user_id = str(row.get("user_id") or "").strip()
        viewer = str(row.get("friendly_name") or row.get("user") or user_id).strip()
        player, platform = str(row.get("player") or "").strip(), str(row.get("platform") or "").strip()
        if not title or not rating or not user_id or not viewer:
            continue
        tid, uid = "tt:" + rating, "u:" + user_id  # "t:" is Prometheus targets; the viewer folds by id prefix
        did = "dev:%s|%s" % (player.lower(), platform.lower()) if player else None
        when = watched(row.get("date"))
        media = "movie" if media_type == "movie" else "show"
        t = titles.setdefault(tid, {"id": tid, "title": title, "media": media, "year": row.get("year"), "plays": 0, "viewers": set(), "last": None, "episode": None})
        t["plays"] += 1
        t["viewers"].add(uid)
        if when and (not t["last"] or when > t["last"]):
            t["last"], t["episode"] = when, row.get("full_title") or row.get("title")
        v = viewers.setdefault(uid, {"id": uid, "label": viewer, "plays": 0, "titles": set(), "devices": set(), "last": None})
        v["plays"] += 1
        v["titles"].add(tid)
        v["last"] = max(filter(None, (v["last"], when)), default=None)
        if did:
            devices.setdefault(did, {"id": did, "label": player, "platform": platform, "product": str(row.get("product") or "").strip()})
            v["devices"].add(did)
        plays.append((uid, tid, did, when))
    kept = sorted(titles.values(), key=lambda t: (-t["plays"], -(t["last"].timestamp() if t["last"] else 0), t["title"].lower()))[:60]
    kept_ids = {t["id"] for t in kept}
    used_viewers = {uid for uid, tid, _, _ in plays if tid in kept_ids}
    used_devices = {did for _, tid, did, _ in plays if tid in kept_ids and did}
    for t in kept:
        label = t["title"] + (" (%s)" % t["year"] if t["media"] == "movie" and t["year"] else "")
        attrs = [["Plays", str(t["plays"])], ["Viewers", str(len(t["viewers"]))]]
        if t["media"] == "show" and t["episode"]:
            attrs.append(["Last watched episode", str(t["episode"])])
        found = library(t["title"], t["year"], t["media"])
        if found:
            attrs += [["In library", found[0]], ["Open", found[1]]]
        node(t["id"], "title", label, "%s · %s · %s · last %s" % (t["media"], _n(t["plays"], "play"), _n(len(t["viewers"]), "viewer"), ago(t["last"])), attrs,
             last=t["last"].isoformat() if t["last"] else None)
    for uid in used_viewers:
        v = viewers[uid]
        node(uid, "viewer", v["label"], "%s · last %s" % (_n(v["plays"], "play"), ago(v["last"])),
             [["Plays", str(v["plays"])], ["Titles", str(len(v["titles"]))], ["Devices", str(len(v["devices"]))]], last=v["last"].isoformat() if v["last"] else None)
    for did in used_devices:
        d = devices[did]
        node(did, "device", d["label"], " · ".join(filter(None, [d["platform"], d["product"]])))
    grouped = {}
    for uid, tid, did, when in plays:
        if tid not in kept_ids or uid not in used_viewers:
            continue
        p = grouped.setdefault((uid, tid), {"plays": 0, "last": None})
        p["plays"] += 1
        p["last"] = max(filter(None, (p["last"], when)), default=None)
        if did:
            edge(uid, did, "watches_on", "watches on", via="Tautulli")
    for (uid, tid), p in grouped.items():
        edge(uid, tid, "watched", "watched", via="Tautulli", detail="%s, last %s" % (_n(p["plays"], "play"), p["last"].date().isoformat() if p["last"] else "unknown"))
    plex = next((i for i, n in nodes.items() if n["kind"] == "app" and n["label"].lower() == "plex"), None)
    if plex:
        for t in kept:
            edge(t["id"], plex, "served_by", "served by", via="Tautulli")
    return nodes, edges


def _seeds(q, nodes):
    t = q.strip().lower()
    if not t:
        return []
    aliases = {"alerts": "alert", "certs": "cert", "certificates": "cert", "incidents": "incident",
               "pending": "pending", "todo": "pending", "videos": "video", "youtube": "video"}
    if t in ("plex activity", "watched"):
        return [i for i, n in nodes.items() if n["kind"] == "title"]
    if t in aliases:
        return [i for i, n in nodes.items() if n["kind"] == aliases[t]]
    exact = [i for i, n in nodes.items() if n["label"].lower() == t or i.split(":", 1)[1].lower() == t]
    if exact:
        return exact
    return [i for i, n in nodes.items() if t in n["label"].lower() or t in i.lower()]


MEDIA_KINDS = ("viewer", "device", "title", "video", "channel")
AIKB_DOWN = "AIKB is unreachable, so notes are left out"


def _n(count, word):
    return "%s %s%s" % (count, word, "" if count == 1 else "s")


def _around(start, edges, depth):
    adj = defaultdict(set)
    for e in edges:
        adj[e["a"]].add(e["b"])
        adj[e["b"]].add(e["a"])
    seen, frontier = set(start), set(start)
    for _ in range(depth):
        frontier = {m for n in frontier for m in adj[n]} - seen
        seen |= frontier
    return seen


def _aikb(endpoint, **params):
    """One GET to the AIKB facade; None when it is down or answers with an error body."""
    url = routes.AIKB_SEARCH_URL() + endpoint + "?" + urlencode(params, doseq=True)
    r = settle(lambda: fetch_local(url, timeout=6))
    # fetch_local hands back an error body as JSON (a 500 from a locked index), so that counts as down too
    return r if isinstance(r, dict) and "error" not in r else None


def _note(file, title=None):
    return {"id": "n:" + file, "kind": "note", "label": title or file.rsplit("/", 1)[-1][:-3], "sub": file,
            "attrs": [["File", file], ["Open", "/aikb/note?path=" + quote(file, safe="")], ["Source", "AIKB"]]}


def _mention(a, nid, section=None, flag=None):
    return {"a": a, "b": nid, "kind": "about", "label": "mentions", "flag": flag,
            "detail": "section: %s" % section if section else None, "via": "AIKB", "prov": _provenance("about", flag, "AIKB")}


def _notes(ids, nodes):
    """AIKB notes that mention these hosts/apps/cards, as extra nodes and edges. None when AIKB is down."""
    asks = [i for i in ids if nodes[i]["kind"] in ("host", "app", "service")][:NOTE_LOOKUPS]
    if not asks:
        return {}, []
    found = parallel(*[(lambda i=i: _aikb("/mentions", name=nodes[i]["label"], limit=NOTES_EACH)) for i in asks])
    if all(f is None for f in found):
        return None, []
    out, edges = {}, []
    for i, f in zip(asks, found):
        for n in (f or {}).get("notes") or []:
            out.setdefault("n:" + n["file"], _note(n["file"], n.get("title")))
            edges.append(_mention(i, "n:" + n["file"], n.get("section")))
    return out, edges


def _joins(files, nodes, F):
    """The fleet nodes each note names (host, app, card, proxy and DNS names by label; IPs by the host that has
    them), as mention edges, plus each note's title. (None, {}) when AIKB is down."""
    got = _aikb("/links", path=files, limit=80)
    if got is None:
        return None, {}
    by = defaultdict(list)
    for i, n in nodes.items():
        if n["kind"] in ("host", "app", "service", "proxy", "dns"):
            by[n["label"].lower()].append(i)
    edges = []
    for file, names in (got.get("links") or {}).items():
        for e in names:
            name = (e.get("name") or "").lower()
            ids = by.get(name) or (["h:" + F["ip_of"][name]] if e.get("kind") == "ip" and name in F["ip_of"] else [])
            # A shared label cannot say which fleet thing the note intended.
            edges += [_mention(i, "n:" + file, flag="ambiguous" if len(ids) > 1 else None) for i in ids if i in nodes]
    return edges, got.get("titles") or {}


def _concept_graph(q, expand, F, videos=False):
    """An AIKB entity co-occurrence lens; it deliberately never expands into fleet topology."""
    if expand:
        return {"q": q, "lens": "concepts", "nodes": [], "edges": [], "seeds": [], "listed": [], "matched": 0,
                "resolved": None, "truncated": False, "coverage": {"list": 0, "covered": 0, "nodes": 0, "groups": []}, "warnings": []}
    _, text = search.parse_scope(q)
    got = _aikb("/concepts", q=text, videos=int(bool(videos)))
    if got is None:
        return {"q": q, "lens": "concepts", "nodes": [], "edges": [], "seeds": [], "listed": [], "matched": 0,
                "resolved": None, "truncated": False, "coverage": {"list": 0, "covered": 0, "nodes": 0, "groups": []},
                "warnings": ["AIKB is unreachable, so concepts are left out"]}
    fleet_nodes, _ = _all(F)
    fleet_labels = {n["label"].lower() for n in fleet_nodes.values() if n["kind"] in ("host", "app", "service")}
    nodes = []
    by_name = {}
    for item in got.get("concepts") or []:
        name = item.get("name") or ""
        ident = "c:" + name.lower()
        node = {"id": ident, "kind": "concept", "label": name,
                "sub": "%s · %s chunks · %s notes" % (item.get("kind"), item.get("count", 0), item.get("notes", 0)),
                "attrs": [["Mentioned in", "%s chunks in %s notes" % (item.get("count", 0), item.get("notes", 0))], ["Kind", item.get("kind")]]}
        if name.lower() in fleet_labels:
            node["attrs"].append(["Also in the fleet", name])
        nodes.append(node)
        by_name[name.lower()] = node
    words = set() if text.strip().lower() in ("*", "all") else set(re.findall(r"[\w-]{3,}", text.lower()))
    seeds = [n["id"] for n in nodes if any(word in n["label"].lower() for word in words)]
    if not seeds:
        counts = {str(x.get("name", "")).lower(): x.get("count", 0) for x in got.get("concepts") or []}
        seeds = [n["id"] for n in sorted(nodes, key=lambda n: (-counts.get(n["label"].lower(), 0), n["label"].lower()))[:5]]
    edges = []
    for edge in got.get("edges") or []:
        a, b = by_name.get(str(edge.get("a", "")).lower()), by_name.get(str(edge.get("b", "")).lower())
        if a and b:
            edges.append({"a": a["id"], "b": b["id"], "kind": "cooccur", "label": "appear together", "detail": "in %s chunks" % edge.get("w", 0), "via": "AIKB", "flag": None, "w": edge.get("w", 0)})
    return {"q": q, "lens": "concepts", "nodes": [dict(n, result=n["id"] in seeds) for n in nodes], "edges": _with_provenance(edges),
            "seeds": seeds, "listed": seeds, "matched": len(seeds), "resolved": None, "truncated": False,
            "coverage": {"list": len(seeds), "covered": len(seeds), "nodes": len(seeds), "groups": []}, "warnings": []}


# Which match a path end means when a name hits several nodes: the thing itself before where it lives
END_ORDER = {k: i for i, k in enumerate(("host", "app", "service", "proxy", "dns", "dataset", "pool", "target", "network"))}


def _path_seed(text, nodes, warnings, extra):
    """The node a path end names; with no fleet match, AIKB's best note for it (added to `extra`)."""
    t = text.strip().lower()
    matches = sorted(_seeds(text, nodes), key=lambda i: (nodes[i]["label"].lower() != t, END_ORDER.get(nodes[i]["kind"], 99)))
    if not matches:
        found = _aikb("/search", q=text, k=1)
        hit = ((found or {}).get("results") or [None])[0]
        if not hit:
            warnings.append("nothing matches '%s'" % text)
            return None
        nid = "n:" + hit["file"]
        extra[nid] = _note(hit["file"], hit.get("title"))
        warnings.append("'%s' isn't in the fleet; using the note %s" % (text, extra[nid]["label"]))
        return nid
    picked = matches[0]
    if len(matches) > 1:
        warnings.append("'%s' matches %s nodes; using %s (%s)" % (text, len(matches), nodes[picked]["label"], nodes[picked]["kind"]))
    return picked


def _path_routes(start, end, edges):
    """The first three BFS routes are shortest; simple paths keep loops out of the answer."""
    adj = defaultdict(list)
    for e in edges:
        adj[e["a"]].append((e["b"], e))
        adj[e["b"]].append((e["a"], e))
    queue, routes, middles = deque([(start, [start], [])]), [], set()
    while queue and len(routes) < 3:
        here, ids, path_edges = queue.popleft()
        if here == end:
            middle = frozenset(ids[1:-1])
            if middle not in middles:
                middles.add(middle)
                provs = [e["prov"] for e in path_edges]
                confidence = "ambiguous" if "ambiguous" in provs else "inferred" if "inferred" in provs else "extracted"
                routes.append({"ids": ids, "hops": len(path_edges), "confidence": confidence, "edges": path_edges})
            continue
        if len(path_edges) == 6:
            continue
        for other, edge in adj[here]:
            if other not in ids:
                queue.append((other, ids + [other], path_edges + [edge]))
    return routes


PROV_RANK = {"extracted": 0, "inferred": 1, "ambiguous": 2}


def _path_graph(q, F, nodes, edges):
    ends = search.parse_path(q)
    warnings, ends_extra = [], {}
    start = _path_seed(ends[0], nodes, warnings, ends_extra)
    end = _path_seed(ends[1], nodes, warnings, ends_extra)
    payload = {"from": start, "to": end, "routes": []}
    if start and start == end:
        warnings.append("both ends are the same node")
        start = end = None
    if not start or not end:
        return {"q": q, "nodes": [], "edges": [], "seeds": [], "listed": [], "matched": 0, "resolved": None, "truncated": False,
                "coverage": {"list": 0, "covered": 0, "nodes": 0, "groups": []}, "warnings": warnings, "path": payload}
    # Only notes tied to either endpoint are bridges; their /links give the other end of each note relation.
    # An end that is itself a note joins through what it names.
    notes, note_edges = _notes([i for i in (start, end) if i in nodes], nodes)
    if notes is not None:
        notes = {**ends_extra, **notes}
    bridge_nodes, bridge_edges = {}, []
    if notes is None:
        warnings.append("AIKB is unreachable, so note bridges are left out")
    else:
        bridge_nodes = notes
        joins, titles = _joins([i[2:] for i in notes], nodes, F) if notes else ([], {})
        if joins is None:
            warnings.append("AIKB is unreachable, so note bridges are left out")
            bridge_nodes, note_edges, joins = {}, [], []
        else:
            for nid, title in titles.items():
                if "n:" + nid in bridge_nodes and title:
                    bridge_nodes["n:" + nid]["label"] = title
            bridge_edges = (note_edges or []) + (joins or [])
    all_nodes = {**nodes, **bridge_nodes}
    # A note relation can arrive from both /mentions and /links; keep one per hop, the best-sourced
    best = {}
    for e in sorted(_with_provenance(edges + bridge_edges), key=lambda e: PROV_RANK.get(e["prov"], 9)):
        best.setdefault((e["a"], e["b"], e["kind"]), e)
    all_edges = list(best.values())
    routes = _path_routes(start, end, all_edges)
    payload["routes"] = [{k: v for k, v in route.items() if k != "edges"} for route in routes]
    if not routes:
        warnings.append("no path from '%s' to '%s' within 6 hops" % ends)
        return {"q": q, "nodes": [], "edges": [], "seeds": [start, end], "listed": [start, end], "matched": 2, "resolved": None, "truncated": False,
                "coverage": {"list": 2, "covered": 0, "nodes": 0, "groups": []}, "warnings": warnings, "path": payload}
    keep = {i for route in routes for i in route["ids"]}
    route_edges = {(e["a"], e["b"], e["kind"]) for route in routes for e in route["edges"]}
    out_edges = [e for e in all_edges if (e["a"], e["b"], e["kind"]) in route_edges]
    return {"q": q, "nodes": [dict(all_nodes[i], result=i in (start, end)) for i in keep], "edges": out_edges, "seeds": [start, end], "listed": [start, end], "matched": 2,
            "resolved": None, "truncated": False, "coverage": {"list": 2, "covered": 2, "nodes": len(keep), "groups": []}, "warnings": warnings, "path": payload}


def _affected_seed(text, nodes, warnings, dependents):
    """A fleet-only path seed: an AIKB note cannot be a dependency outage.
    Among same-name matches, one with dependents wins (the Vaultwarden dataset, not its dashboard card)."""
    t = text.strip().lower()
    fleet_nodes = {i: n for i, n in nodes.items() if n["kind"] not in NOT_FLEET}
    matches = sorted(_seeds(text, fleet_nodes), key=lambda i: (nodes[i]["label"].lower() != t, not dependents[i],
                                                                 END_ORDER.get(nodes[i]["kind"], 99)))
    if not matches:
        warnings.append("nothing in the fleet matches '%s'" % text)
        return None
    picked = matches[0]
    if len(matches) > 1:
        warnings.append("'%s' matches %s nodes; using %s (%s)" % (text, len(matches), nodes[picked]["label"], nodes[picked]["kind"]))
    return picked


def _affected_graph(q, nodes, edges):
    name = search.parse_affected(q) or ""
    warnings = []
    # Reverse the dependency arrow: an outage travels from a dependency to its dependents.
    dependents = defaultdict(list)
    for e in edges:
        end = DEPENDS.get(e["kind"])
        if end == "b":
            dependents[e["a"]].append((e["b"], e))
        elif end == "a":
            dependents[e["b"]].append((e["a"], e))
    start = _affected_seed(name, nodes, warnings, dependents)
    empty = {"q": q, "nodes": [], "edges": [], "seeds": [], "listed": [], "matched": 0, "resolved": None,
             "truncated": False, "coverage": {"list": 0, "covered": 0, "nodes": 0, "groups": []}, "warnings": warnings,
             "affected": {"from": start, "count": 0, "by_kind": {}, "hops": {}}}
    if not start:
        return empty
    seen, hops, reached, queue = {start}, {}, {}, deque([(start, 0)])
    while queue:
        here, depth = queue.popleft()
        if depth == 4:
            continue
        for other, edge in dependents[here]:
            if other in seen:
                continue
            seen.add(other)
            hop = depth + 1
            hops[other], reached[other] = hop, (here, edge)
            queue.append((other, hop))
    first = [i for i in hops if hops[i] == 1]
    ordered = sorted(hops, key=lambda i: (hops[i], nodes[i]["label"].lower(), i))
    keep = {start, *first}   # never hide the immediate blast radius
    keep.update([i for i in ordered if i not in keep][:max(0, CAP - len(keep))])
    truncated = len(keep) < len(hops) + 1
    by_kind = defaultdict(int)
    for i in hops:
        by_kind[nodes[i]["kind"]] += 1
    out = [dict(nodes[start], result=True)]
    for i in ordered:
        if i not in keep:
            continue
        previous, edge = reached[i]
        # Result rings and the seed reticle are existing graph language; hop carries the ordering and annotation.
        out.append(dict(nodes[i], result=True, hop=hops[i], via=edge["label"], via_node=previous))
    used = {(edge["a"], edge["b"], edge["kind"]) for i, (_, edge) in reached.items() if i in keep}
    out_edges = [e for e in edges if (e["a"], e["b"], e["kind"]) in used]
    return {"q": q, "nodes": out, "edges": out_edges, "seeds": [start], "listed": [start] + [i for i in ordered if i in keep],
            "matched": len(hops) + 1, "resolved": nodes[start]["label"], "truncated": truncated,
            "coverage": {"list": len(hops) + 1, "covered": len(keep), "nodes": len(keep), "groups": []}, "warnings": warnings,
            "affected": {"from": start, "count": len(hops), "by_kind": dict(by_kind), "hops": hops}}


def _snapshot_nodes_edges(nodes, edges):
    """The daily history is infrastructure only; notes and media churn independently."""
    keep = {i for i, n in nodes.items() if n["kind"] not in SNAPSHOT_SKIP}
    return {"nodes": {i: [nodes[i]["kind"], nodes[i]["label"]] for i in sorted(keep)},
            "edges": [list(e) for e in sorted({(e["a"], e["b"], e["kind"]) for e in edges if e["a"] in keep and e["b"] in keep})]}


def _snapshot_dir():
    return common.DATA_DIR / "graph-snapshots"


def _today():
    return datetime.now().date().isoformat()


def _write_snapshot(nodes, edges, today=None):
    """One atomic daily baseline; graph queries must still work on a read-only disk."""
    today = today or _today()
    folder, target = _snapshot_dir(), _snapshot_dir() / (today + ".json")
    # right after start the mirror can still be empty; that must not become the day's baseline
    if not any(n["kind"] == "host" for n in nodes.values()):
        return
    with _snapshot_lock:   # ThreadingHTTPServer: two first-of-the-day requests share one pid
        _write_snapshot_locked(nodes, edges, folder, target)


def _write_snapshot_locked(nodes, edges, folder, target):
    try:
        if not target.exists():
            folder.mkdir(parents=True, exist_ok=True)
            tmp = folder / ("." + target.name + ".%s.tmp" % os.getpid())
            try:
                with tmp.open("w") as f:
                    json.dump(_snapshot_nodes_edges(nodes, edges), f, sort_keys=True)
                os.replace(tmp, target)
            finally:
                if tmp.exists():
                    tmp.unlink()
        files = sorted(folder.glob("*.json"), reverse=True)
        for old in files[SNAPSHOT_DAYS:]:
            old.unlink()
    except OSError as e:
        _log.warning("graph snapshot: %s", e)


def _previous_snapshot(today=None):
    today = today or _today()
    try:
        files = sorted((p for p in _snapshot_dir().glob("*.json") if p.stem < today), reverse=True)
        if not files:
            return None, None
        with files[0].open() as f:
            return files[0].stem, json.load(f)
    except (OSError, ValueError, TypeError) as e:
        _log.warning("graph snapshot read: %s", e)
        return None, None


def _changes_graph(q, nodes, edges):
    since, before = _previous_snapshot()
    empty = {"q": q, "nodes": [], "edges": [], "seeds": [], "listed": [], "matched": 0, "resolved": None,
             "truncated": False, "coverage": {"list": 0, "covered": 0, "nodes": 0, "groups": []}, "warnings": [],
             "changes": {"since": since, "added": 0, "removed": 0, "edges_added": 0, "edges_removed": 0}}
    if not before:
        empty["warnings"].append("no earlier snapshot yet; check back tomorrow")
        return empty
    current = _snapshot_nodes_edges(nodes, edges)
    old_nodes = before.get("nodes") or {}
    old_edges = {tuple(e) for e in before.get("edges") or []}
    cur_nodes, cur_edges = current["nodes"], {tuple(e) for e in current["edges"]}
    added, removed = set(cur_nodes) - set(old_nodes), set(old_nodes) - set(cur_nodes)
    edges_added, edges_removed = cur_edges - old_edges, old_edges - cur_edges
    keep = set(added)
    for a, b, _ in edges_added:   # a new link between two old nodes is a change too
        keep.update((a, b))
    for a, b, _ in edges_removed:
        keep.update(i for i in (a, b) if i in cur_nodes)
    out = [dict(nodes[i], change="added", change_since=since, result=True) for i in sorted(added)]
    out += [dict(nodes[i], result=False) for i in sorted(keep - added) if i in nodes]
    for i in sorted(removed):
        kind, label = (list(old_nodes[i]) + [i, i])[:2]
        out.append({"id": i, "kind": kind, "label": label, "sub": "gone since %s" % since, "attrs": [],
                    "missing": True, "change": "removed", "change_since": since, "result": True})
    out_ids = {n["id"] for n in out}
    out_edges = [e for e in edges if e["a"] in out_ids and e["b"] in out_ids]
    out_edges += [{"a": a, "b": b, "kind": kind, "label": "was %s" % kind, "flag": "missing", "via": "snapshot", "detail": "removed since %s" % since}
                  for a, b, kind in sorted(edges_removed) if a in out_ids and b in out_ids]
    empty.update({"nodes": out, "edges": out_edges, "seeds": [n["id"] for n in out if n.get("change")], "listed": [n["id"] for n in out],
                  "matched": len(added) + len(removed), "coverage": {"list": len(added) + len(removed), "covered": len(out), "nodes": len(out), "groups": []},
                  "changes": {"since": since, "added": len(added), "removed": len(removed), "edges_added": len(edges_added), "edges_removed": len(edges_removed)}})
    return empty


def build(q, expand=None, live=False, lens=None, videos=False):
    F = fleet.get()
    if lens == "concepts":
        return _concept_graph(q, expand, F, videos)
    warnings = []
    _media_state.warning = False
    nodes, edges = _all(F, live=live)
    _write_snapshot(nodes, edges)
    if getattr(_media_state, "warning", False):
        warnings.append("Tautulli is unavailable, so media activity is left out")
    edges = _with_provenance(edges)
    if not expand and search.parse_path(q):
        return _path_graph(q, F, nodes, edges)
    if not expand and search.parse_affected(q):
        return _affected_graph(q, nodes, edges)
    if not expand and search.parse_changes(q):
        data = _changes_graph(q, nodes, edges)
        data["edges"] = _with_provenance(data["edges"])
        return data
    everything = not expand and q.strip() in ("*", "all")
    # host:/app:/media:/kb:/ops: prefixes as the search bar has them; kb: starts from notes only
    scope, text = search.parse_scope(q)
    notes_only = scope == "aikb"
    # a node removed since the snapshot (`changes:`) has nothing around it now; notes join further down
    if expand and expand not in nodes and not expand.startswith("n:"):
        return {"q": q, "nodes": [], "edges": [], "seeds": [], "listed": [], "matched": 0, "resolved": None, "truncated": False,
                "coverage": {"list": 0, "covered": 0, "nodes": 0, "groups": []}, "warnings": ["%s is no longer in the fleet" % expand]}
    if expand:
        keep = _around([expand], edges, 1) if expand in nodes else set()
        seeds = [expand]
    else:
        if everything:
            seeds = list(nodes)
        elif scope == "ops":
            ops = {i: n for i, n in nodes.items() if n["kind"] in ("alert", "cert", "incident", "pending")}
            seeds = _seeds(text, ops) if text else list(ops)
        elif scope == "media":
            media = {i: n for i, n in nodes.items() if n["kind"] in MEDIA_KINDS}
            seeds = _seeds(text, media) if text else [i for i, n in media.items() if n["kind"] == "title"]
        else:
            seeds = [] if notes_only else _seeds(text, nodes)
        if everything:
            keep = set(nodes)
        # a video's own note is seeded with it (same title), so notes don't make a search a fleet one
        elif scope == "media" or (any(nodes[i]["kind"] in MEDIA_KINDS for i in seeds)
                                  and all(nodes[i]["kind"] in MEDIA_KINDS + ("note",) for i in seeds)):
            # who watched it and what else they watched, but not every title Plex serves
            own = [e for e in edges if e["kind"] != "served_by"]
            keep = _around(seeds, own, DEPTH) | _around(seeds, edges, 1)
        else:
            # Plex history is 90 leaf nodes: a host two hops from Plex must not pull every title in.
            # They show one hop from a start node (searching plex lists what was watched), no further.
            fleet_edges = [e for e in edges if nodes.get(e["a"], {}).get("kind") not in MEDIA_KINDS and nodes.get(e["b"], {}).get("kind") not in MEDIA_KINDS]
            keep = _around(seeds, fleet_edges, DEPTH) | (_around(seeds, edges, 1) - _around(seeds, fleet_edges, 1))
    truncated = len(keep) > CAP
    if truncated:   # keep the start nodes and their nearest first
        keep = set(seeds[:CAP]) | set(sorted(keep - set(seeds), key=lambda i: (nodes[i]["kind"] == "proxy", i))[:max(0, CAP - len(seeds))])
    out = {i: dict(nodes[i], result=i in seeds) for i in keep}
    out_edges = [e for e in edges if e["a"] in keep and e["b"] in keep]
    if not everything:
        # Notes that answer the search itself (a text search, or expanding a note) join as start nodes, linked to
        # the fleet nodes they name; those join the graph on their own, without their neighborhoods
        found = {}
        if expand and expand.startswith("n:"):
            found[expand] = _note(expand[2:])   # the viewer already has this node; the title comes from /links below
        elif not expand and len(text) >= 3:
            res = _aikb("/search", q=text, k=NOTE_SEEDS)
            if res is None:
                warnings.append("AIKB is unreachable, so notes are left out")
            for r in (res or {}).get("results") or []:
                found.setdefault("n:" + r["file"], dict(_note(r["file"], r.get("title")), result=True))
        joins, titles = _joins([i[2:] for i in found], nodes, F) if found else ([], {})
        if joins is None:
            # Nothing from AIKB: an expanded note must come back empty-handed, not as "no neighbors"
            found = {}
            if AIKB_DOWN not in warnings:
                warnings.append(AIKB_DOWN)
        for nid in found:
            if titles.get(nid[2:]):
                found[nid]["label"] = titles[nid[2:]]
        for nid, n in found.items():
            out.setdefault(nid, dict(n, result=n.get("result", False)))
            out[nid]["result"] = out[nid]["result"] or n.get("result", False)   # a search hit already pulled in as a neighbor
        # a video already in the graph keeps the edge to its note when search brings that note in
        out_edges += [e for e in edges if e["kind"] == "noted" and e["b"] in found and e["a"] in out and e["b"] not in keep]
        joins = joins or []
        for e in joins:
            if e["a"] not in out and len(out) >= CAP:
                truncated = True
                continue
            out.setdefault(e["a"], dict(nodes[e["a"]], result=False))
        out_edges += [e for e in joins if e["a"] in out]
        seeds += [i for i in found if i not in seeds]
        notes, note_edges = _notes([s for s in seeds if s in keep], nodes)
        if notes is None:
            if AIKB_DOWN not in warnings:
                warnings.append(AIKB_DOWN)
        else:
            for nid, n in notes.items():
                out.setdefault(nid, dict(n, result=False))
            out_edges += note_edges
    seen = set()
    out_edges = [e for e in out_edges if (e["a"], e["b"], e["kind"]) not in seen and not seen.add((e["a"], e["b"], e["kind"]))]
    hosts = [s for s in seeds if s.startswith("h:")]
    return {"q": q, "nodes": list(out.values()), "edges": _with_provenance(out_edges), "seeds": seeds[:50], "listed": seeds, "matched": len(seeds),
            "resolved": nodes[hosts[0]]["label"] if len(hosts) == 1 else None, "truncated": truncated,
            "coverage": {"list": len(seeds), "covered": len(seeds), "nodes": len(seeds), "groups": []}, "warnings": warnings}


# ── "Explain this graph": on request only ─────────────────────────────────────

EXPLAIN_SYSTEM = ("You are a home-lab infrastructure analyst. Use only the facts given about hosts, apps, datasets, "
                  "proxy and DNS names, AIKB notes and concepts. Never invent names, hosts or numbers. Plain, short sentences.")
EXPLAIN_PROMPT = """Below are relationships from a home-lab graph. Each line reads "A --relation--> B".

{summary}

Start directly with findings. Do not describe the page, graph, node counts or interface. Write exactly these three short parts:
How it fits together: 3 to 6 bullets tracing useful relationships.
Needs attention: only conflicts, missing links or weak spots present in the data.
Look at next: 2 or 3 concrete checks or note ideas, each naming the thing to check.
About 250 words at most."""
BRIDGE_PROMPT = """These are two weakly connected topics in Tim's home-lab notes.

Topic A: {a}
Topic B: {b}

Using only these names, write exactly 3 short research questions or AIKB note ideas that could connect the topics. No preamble."""


def _explain_text(summary):
    """Readable, bounded relationship facts for the model and the request audit."""
    out = ["QUESTION: %s" % summary.get("question", "")]
    def section(title, values):
        if values:
            out.append(title + ":")
            out.extend("- " + str(value) for value in (values if isinstance(values, list) else [values]))
    if summary.get("searched_for"):
        out.append("SEARCHED FOR: %s%s" % (summary["searched_for"], " (start items: %s)" % ", ".join(summary.get("seeds") or []) if summary.get("seeds") else ""))
    if summary.get("focus"):
        out.append("FOCUS: " + ", ".join(summary["focus"]))
    compare = summary.get("compare")
    if compare:
        section("COMPARE (the main question): selected", [", ".join(compare.get("picks") or [])])
        section("They share", compare.get("shared"))
        section("They differ", compare.get("differ"))
        section("Other links in common", compare.get("other_common_links"))
    selected = summary.get("selection")
    if selected:
        out.append("SELECTION: %s: %s" % (selected.get("name"), selected.get("about") or ""))
        section("Its attributes", selected.get("attributes"))
        section("Its relationships", selected.get("links"))
    section("RELATIONSHIPS", summary.get("relationships"))
    section("NEEDS ATTENTION (flagged in the data)", summary.get("needs_attention"))
    return "\n".join(out)


def explain(body):
    """(status, payload) for the Hopper-only graph explanation request."""
    if not isinstance(body, dict) or not isinstance(body.get("summary"), dict):
        return 400, {"error": "summary is required"}
    if len(json.dumps(body["summary"])) > 20000:
        return 400, {"error": "summary is too large"}
    mode = body.get("mode", "graph")
    if mode not in ("graph", "bridge"):
        return 400, {"error": "invalid mode"}
    if mode == "bridge":
        gap = body.get("gap")
        if not isinstance(gap, dict) or not all(isinstance(gap.get(k), list) for k in ("a", "b")):
            return 400, {"error": "bridge gap is required"}
        prompt = BRIDGE_PROMPT.format(a=", ".join(map(str, gap["a"][:6])), b=", ".join(map(str, gap["b"][:6])))
        basis = "two weakly connected note topics"
    else:
        prompt = EXPLAIN_PROMPT.format(summary=_explain_text(body["summary"]))
        counts = body["summary"].get("counts") or {}
        basis = "%s relationships, %s flags" % (counts.get("relationships", 0), counts.get("flags", 0))
    model = routes.cfg("LLM_MODEL", "nemotron-3.5-lightning")
    payload = {"model": model, "messages": [{"role": "system", "content": EXPLAIN_SYSTEM}, {"role": "user", "content": "/no_think\n" + prompt}],
               "max_tokens": 700, "chat_template_kwargs": {"enable_thinking": False}}
    try:
        response = request(routes.cfg("LLM_URL", "http://hopper:8012/v1/chat/completions"), method="POST", body=payload, timeout=150)
        data = response.json
        if response.status >= 400:
            err = data.get("error") if isinstance(data, dict) else None
            raise RuntimeError((err.get("message") if isinstance(err, dict) else err) or "model request failed (HTTP %s)" % response.status)
        answer = (((((data or {}).get("choices") or [{}])[0] or {}).get("message") or {}).get("content") or "").strip()
    except Exception as exc:  # noqa: BLE001 - surfaced in the Explain panel
        return 502, {"error": str(exc) or type(exc).__name__}
    if not answer:
        return 504, {"error": "the model returned nothing (timeout or error)"}
    return 200, {"text": answer, "model": model, "backend": "hopper", "basis": basis}

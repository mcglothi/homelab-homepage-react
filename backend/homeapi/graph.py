"""/api/graph — the relationship graph behind the search Graph view, as {nodes, edges}.
Same contract as the work Docket's graph (its Graph front end runs on it). Built from the
mirror (fleet.py) only; ?live=1 adds Prometheus targets.

Every edge runs parent (a) -> child (b). The chains:
    host -> pool -> dataset -> child dataset ; dataset -> app that mounts it
    host -> app it runs ; host -> VM (a VM is a host of its own)
    proxy name -> app or host it forwards to ; DNS name -> host it resolves to
    dashboard card -> proxy name in its link ; monitoring target -> host it scrapes
Edge flags: "inferred" (an app matched by its default port, not a published one),
"missing" (a proxy forwarding to an address no host claims), "derived" (joined by IP).

Node ids: h: host, pl: pool, ds: dataset, a: app, px: proxy name, d: DNS name, svc: card,
ip: an address with no host, t: monitoring target, q: the search.
"""

from collections import defaultdict
from urllib.parse import urlsplit

from . import fleet, routes
from .common import fetch_local

CAP = 400      # nodes per graph; `truncated` says when it bites
DEPTH = 2      # hops from the start nodes


def _gb(n):
    return "%.1f GB" % (n / 1e9) if n else "—"


def _all(F, live=False):
    """Every node and edge the mirror knows (a few hundred), keyed by id."""
    nodes, edges, eseen = {}, [], set()

    def node(id, kind, label, sub="", attrs=None, **extra):
        nodes.setdefault(id, {"id": id, "kind": kind, "label": label, "sub": sub, "attrs": attrs or [], **extra})
        return id

    def edge(a, b, kind, label, flag=None, via=None, detail=None):
        if a in nodes and b in nodes and (a, b, kind) not in eseen:
            eseen.add((a, b, kind))
            edges.append({"a": a, "b": b, "kind": kind, "label": label, "flag": flag, "detail": detail, "via": via})

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
    return nodes, edges


def _seeds(q, nodes):
    t = q.strip().lower()
    if not t:
        return []
    exact = [i for i, n in nodes.items() if n["label"].lower() == t or i.split(":", 1)[1].lower() == t]
    if exact:
        return exact
    return [i for i, n in nodes.items() if t in n["label"].lower() or t in i.lower()]


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


def build(q, expand=None, live=False):
    F = fleet.get()
    nodes, edges = _all(F, live=live)
    if expand:
        keep = _around([expand], edges, 1) if expand in nodes else set()
        seeds = [expand]
    else:
        everything = q.strip() in ("*", "all")
        seeds = list(nodes) if everything else _seeds(q, nodes)
        keep = set(nodes) if everything else _around(seeds, edges, DEPTH)
    truncated = len(keep) > CAP
    if truncated:   # keep the start nodes and their nearest first
        keep = set(seeds[:CAP]) | set(sorted(keep - set(seeds), key=lambda i: (nodes[i]["kind"] == "proxy", i))[:max(0, CAP - len(seeds))])
    out_nodes = [dict(nodes[i], result=i in seeds) for i in keep]
    out_edges = [e for e in edges if e["a"] in keep and e["b"] in keep]
    hosts = [s for s in seeds if s.startswith("h:")]
    return {"q": q, "nodes": out_nodes, "edges": out_edges, "seeds": seeds[:50], "listed": seeds, "matched": len(seeds),
            "resolved": nodes[hosts[0]]["label"] if len(hosts) == 1 else None, "truncated": truncated,
            "coverage": {"list": len(seeds), "covered": len(seeds), "nodes": len(seeds), "groups": []}, "warnings": []}

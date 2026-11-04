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
ip: an address with no host, t: monitoring target, n: an AIKB note, q: the search.
AIKB notes join last: host/app/card -> each note that mentions it (AIKB_SEARCH_URL /mentions),
only for the start nodes (or the node being expanded), so the graph stays readable. A text search
also starts from the notes AIKB finds for it (/search), joined to the fleet nodes they name
(/links); `kb:` searches start from notes only. Expanding a note adds what it names.
"""

from collections import defaultdict
import json
import re
from urllib.parse import quote, urlencode, urlsplit

from . import fleet, routes, search
from .common import fetch_local, parallel, request, settle

CAP = 400      # nodes per graph; `truncated` says when it bites
DEPTH = 2      # hops from the start nodes
NOTE_LOOKUPS = 6   # hosts/apps asked about per graph
NOTES_EACH = 5     # notes per host/app
NOTE_SEEDS = 8     # notes a text search starts from


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


def _aikb(endpoint, **params):
    """One GET to the AIKB facade; None when it is down or answers with an error body."""
    url = routes.AIKB_SEARCH_URL() + endpoint + "?" + urlencode(params, doseq=True)
    r = settle(lambda: fetch_local(url, timeout=6))
    # fetch_local hands back an error body as JSON (a 500 from a locked index), so that counts as down too
    return r if isinstance(r, dict) and "error" not in r else None


def _note(file, title=None):
    return {"id": "n:" + file, "kind": "note", "label": title or file.rsplit("/", 1)[-1][:-3], "sub": file,
            "attrs": [["File", file], ["Open", "/aikb/note?path=" + quote(file, safe="")], ["Source", "AIKB"]]}


def _mention(a, nid, section=None):
    return {"a": a, "b": nid, "kind": "about", "label": "mentions", "flag": None,
            "detail": "section: %s" % section if section else None, "via": "AIKB"}


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
            edges += [_mention(i, "n:" + file) for i in ids if i in nodes]
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
    words = set(re.findall(r"[\w-]{3,}", text.lower()))
    seeds = [n["id"] for n in nodes if any(word in n["label"].lower() for word in words)]
    if not seeds:
        counts = {str(x.get("name", "")).lower(): x.get("count", 0) for x in got.get("concepts") or []}
        seeds = [n["id"] for n in sorted(nodes, key=lambda n: (-counts.get(n["label"].lower(), 0), n["label"].lower()))[:5]]
    edges = []
    for edge in got.get("edges") or []:
        a, b = by_name.get(str(edge.get("a", "")).lower()), by_name.get(str(edge.get("b", "")).lower())
        if a and b:
            edges.append({"a": a["id"], "b": b["id"], "kind": "cooccur", "label": "appear together", "detail": "in %s chunks" % edge.get("w", 0), "via": "AIKB", "flag": None, "w": edge.get("w", 0)})
    return {"q": q, "lens": "concepts", "nodes": [dict(n, result=n["id"] in seeds) for n in nodes], "edges": edges,
            "seeds": seeds, "listed": seeds, "matched": len(seeds), "resolved": None, "truncated": False,
            "coverage": {"list": len(seeds), "covered": len(seeds), "nodes": len(seeds), "groups": []}, "warnings": []}


def build(q, expand=None, live=False, lens=None, videos=False):
    F = fleet.get()
    if lens == "concepts":
        return _concept_graph(q, expand, F, videos)
    nodes, edges = _all(F, live=live)
    everything = not expand and q.strip() in ("*", "all")
    # host:/app:/media:/kb: prefixes as the search bar has them; kb: starts from notes only
    scope, text = search.parse_scope(q)
    notes_only = scope == "aikb"
    if expand:
        keep = _around([expand], edges, 1) if expand in nodes else set()
        seeds = [expand]
    else:
        seeds = list(nodes) if everything else [] if notes_only else _seeds(text, nodes)
        keep = set(nodes) if everything else _around(seeds, edges, DEPTH)
    truncated = len(keep) > CAP
    if truncated:   # keep the start nodes and their nearest first
        keep = set(seeds[:CAP]) | set(sorted(keep - set(seeds), key=lambda i: (nodes[i]["kind"] == "proxy", i))[:max(0, CAP - len(seeds))])
    out = {i: dict(nodes[i], result=i in seeds) for i in keep}
    out_edges = [e for e in edges if e["a"] in keep and e["b"] in keep]
    warnings = []
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
            if not warnings:
                warnings.append("AIKB is unreachable, so notes are left out")
        for nid in found:
            if titles.get(nid[2:]):
                found[nid]["label"] = titles[nid[2:]]
        for nid, n in found.items():
            out.setdefault(nid, dict(n, result=n.get("result", False)))
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
            if not warnings:
                warnings.append("AIKB is unreachable, so notes are left out")
        else:
            for nid, n in notes.items():
                out.setdefault(nid, dict(n, result=False))
            out_edges += note_edges
    seen = set()
    out_edges = [e for e in out_edges if (e["a"], e["b"], e["kind"]) not in seen and not seen.add((e["a"], e["b"], e["kind"]))]
    hosts = [s for s in seeds if s.startswith("h:")]
    return {"q": q, "nodes": list(out.values()), "edges": out_edges, "seeds": seeds[:50], "listed": seeds, "matched": len(seeds),
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
        section("SELECTION: %s: %s" % (selected.get("name"), selected.get("about") or ""), selected.get("attributes"))
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
            raise RuntimeError((data or {}).get("error", {}).get("message") if isinstance(data, dict) else "model request failed")
        answer = (((data or {}).get("choices") or [{}])[0].get("message") or {}).get("content", "").strip()
    except Exception as exc:  # noqa: BLE001 - surfaced in the Explain panel
        return 502, {"error": str(exc) or type(exc).__name__}
    if not answer:
        return 504, {"error": "the model returned nothing (timeout or error)"}
    return 200, {"text": answer, "model": model, "backend": "hopper", "basis": basis}

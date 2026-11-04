"""One joined view of the mirror, shared by search and the graph: hosts by short name and
by IP, and every other item with what it points at resolved to a host.

Hosts come from three places that name the same machines differently: the TrueNAS host
itself, AdGuard rewrites (<name>.home.timmcg.net -> IP) and TrueNAS VMs. They are joined on
short name and IP. Rebuilt when the mirror changes (cheap: a few hundred rows).
"""

import ipaddress
import os
import threading

from . import mirror, routes

ZONE = ".home.timmcg.net"
_cache = {"key": None, "F": None}
_lock = threading.Lock()


def is_ip(t):
    try:
        ipaddress.ip_address(str(t).strip())
        return True
    except ValueError:
        return False


def short(name):
    t = (name or "").strip().lower().rstrip(".")
    return t if is_ip(t) else t.split(".")[0]


def _build():
    by = {}
    for it in mirror.items():
        by.setdefault(it["kind"], []).append(it)
    hosts, ip_of = {}, {}

    def host(name, ip=None, via=None, **extra):
        k = short(name)
        h = hosts.setdefault(k, {"name": k, "ips": [], "via": [], "role": None, "os": None})
        if ip and ip not in h["ips"]:
            h["ips"].append(ip)
        if via and via not in h["via"]:
            h["via"].append(via)
        for key, v in extra.items():
            if v and not h.get(key):
                h[key] = v
        return h

    for h in by.get("host", []):
        host(h["name"], h.get("ip"), "TrueNAS", role=h.get("role"), os=h.get("os"))
    for v in by.get("vm", []):
        host(v["name"], None, "TrueNAS VM", vm_on=v.get("host"), state=v.get("state"))
    for d in by.get("dns", []):
        n = d["name"]
        if n.startswith("*") or not d.get("answer") or not is_ip(d["answer"]):
            continue
        k = short(n)
        if any(k == a for a in (x["name"] for x in by.get("app", []))):
            continue   # an app's own name (plex.home…) is not a machine
        host(k, d["answer"], "AdGuard DNS")
    for n in by.get("node", []):
        # The given name (turing, newton); the OS hostname can be "localhost" or "invalid-…"
        host(n["name"], None, "Headscale", tail_ips=n.get("ips"), online=n.get("online"))
    # Two DNS names for one machine (newton, newton10g) stay separate hosts but share nothing else.
    for k, h in hosts.items():
        for ip in h["ips"]:
            ip_of.setdefault(ip, k)

    apps = {a["name"]: a for a in by.get("app", [])}
    port_app = {}
    for a in apps.values():
        for p in a.get("ports") or []:
            port_app[(a.get("host"), p)] = a["name"]
    # Ports the TrueNAS app list does not publish (host networking): match by the
    # proxy target port on the app's default port, from the dashboard catalog URL defaults.
    for name, port in (("plex", 32400), ("overseerr", 30042), ("transmission", 30096), ("jellyfin", 30013)):
        if name in apps:
            port_app.setdefault((apps[name].get("host"), port), name)

    datasets = sorted(by.get("dataset", []), key=lambda d: -len(d.get("mountpoint") or ""))

    def dataset_of(path):
        for d in datasets:
            mp = d.get("mountpoint") or ""
            if mp and (path == mp or path.startswith(mp + "/")):
                return d["name"]
        return None

    for a in apps.values():
        a["datasets"] = sorted({ds for m in a.get("mounts") or [] for ds in [dataset_of(m)] if ds})

    proxies = by.get("proxy", [])
    for p in proxies:
        up = (p.get("upstream") or "").strip()
        hk = ip_of.get(up) if is_ip(up) else (short(up) if short(up) in hosts else None)
        p["host"] = hk
        p["app"] = port_app.get((hk, p.get("port"))) if hk else None
        if not hk and up:
            p["host_ip"] = up if is_ip(up) else None

    cards = routes.catalog()
    proxy_by_name = {p["name"]: p for p in proxies}
    for c in cards:
        from urllib.parse import urlsplit
        hn = (urlsplit(c["href"]).hostname or "").lower()
        c["proxy"] = hn if hn in proxy_by_name else None
        c["hostname"] = hn

    return {"hosts": hosts, "ip_of": ip_of, "apps": apps, "datasets": {d["name"]: d for d in by.get("dataset", [])},
            "pools": {p["name"]: p for p in by.get("pool", [])}, "vms": {v["name"]: v for v in by.get("vm", [])},
            "proxies": proxy_by_name, "dns": {d["name"]: d for d in by.get("dns", [])},
            "nodes": by.get("node", []), "cards": cards, "runs": mirror.runs()}


def get():
    key = (mirror.DB.stat().st_mtime if mirror.DB.exists() else None,
           os.path.getmtime(routes.SERVICES_JS))
    with _lock:
        if _cache["key"] != key:
            _cache["F"], _cache["key"] = _build(), key
        return _cache["F"]

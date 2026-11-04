"""TrueNAS SCALE (REST v2.0): the host, pools, datasets, apps and VMs."""

from ..common import get_json, parallel, secret, setting

KINDS = ("host", "pool", "dataset", "app", "vm")


def collect():
    key = secret("TRUENAS_API_KEY")
    if not key:
        return None
    base = setting("TRUENAS_URL", "https://truenas.home.timmcg.net").rstrip("/") + "/api/v2.0"
    h = {"Authorization": "Bearer %s" % key}
    info, pools, datasets, apps, vms = parallel(*[
        (lambda p=p: get_json(base + p, headers=h, timeout=90)) for p in
        ("/system/info", "/pool", "/pool/dataset?extra.flat=true&extra.retrieve_properties=false", "/app", "/vm")])
    host = (info.get("hostname") or "truenas").split(".")[0]
    ip = setting("HOMELAB_IP", "10.10.10.10")
    rows = [("host", host, host, {"ip": ip, "os": info.get("version"), "role": "TrueNAS"})]
    rows += [("pool", p["name"], p["name"], {"host": host, "status": p.get("status"), "healthy": p.get("healthy")}) for p in pools]
    for d in datasets:
        used = (d.get("used") or {}).get("parsed")
        rows.append(("dataset", d["id"], d["id"], {"pool": d.get("pool"), "mountpoint": d.get("mountpoint"),
                                                   "used": used, "parent": d["id"].rsplit("/", 1)[0] if "/" in d["id"] else None}))
    for a in apps:
        w = a.get("active_workloads") or {}
        rows.append(("app", a["name"], a["name"], {
            "host": host, "state": a.get("state"), "version": a.get("human_version") or a.get("version"),
            "images": sorted(set(w.get("images") or [])),
            "ports": sorted({hp["host_port"] for p in w.get("used_ports") or [] for hp in p.get("host_ports") or []}),
            "mounts": sorted({v["source"] for v in w.get("volumes") or [] if v.get("type") == "bind" or str(v.get("source", "")).startswith("/mnt/")}),
            "portals": a.get("portals") or {}, "custom": a.get("custom_app"),
            "update": bool(a.get("upgrade_available") or a.get("image_updates_available"))}))
    rows += [("vm", v["name"], v["name"], {"host": host, "state": (v.get("status") or {}).get("state"),
                                            "vcpus": v.get("vcpus"), "memory": v.get("memory")}) for v in vms]
    return rows

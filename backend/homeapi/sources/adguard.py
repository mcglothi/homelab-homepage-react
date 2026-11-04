"""AdGuard Home: DNS rewrites (name -> answer) and named clients."""

from ..common import basic, get_json, setting

KINDS = ("dns", "client")


def collect():
    pw = setting("ADGUARD_PASSWORD")
    if not pw:
        return None
    base = setting("ADGUARD_URL", "http://10.10.10.10:3000").rstrip("/")
    h = {"Authorization": basic(setting("ADGUARD_USER", "admin"), pw)}
    rows = [("dns", r["domain"], r["domain"], {"answer": r.get("answer")}) for r in get_json(base + "/control/rewrite/list", headers=h)]
    clients = get_json(base + "/control/clients", headers=h) or {}
    rows += [("client", c["name"], c["name"], {"ids": c.get("ids") or [], "tags": c.get("tags") or []})
             for c in clients.get("clients") or []]
    return rows
